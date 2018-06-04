/*
  current constraints:
  var deviceId = $( "#device-id" ).val();
  var geoloc = $( "#geoloc-constraint" ).val();
  var network = $( "#network-constraint" ).val();
  var compute = $( "#compute-constraint" ).val();
  var storage = $( "#storage-constraint" ).val();
  var custom = $( "#custom-constraint" ).val();
*/

// dnr node can 
// 1. acts nothing
// 2. drop the message
// 3. forward the message to a different destination
// cDnrNode.on('input', function(){

// })
"use strict";
var utils = require("./utils")
var os = require('os')

var CONTEXT_SNAPSHOT = 5000

function Context(){
  this.deviceId = null 
  this.deviceName = null 
  this.cores = os.cpus().length
  this.freeMem = os.freemem()/1000000

  this.timer = setInterval((function(context){
    return function(){
      context.snapshot.call(context)
    }
  })(this), CONTEXT_SNAPSHOT)
}

Context.prototype.destroy = function() {
  clearInterval(this.timer)
  delete this.deviceId
  delete this.deviceName
  delete this.cores
  delete this.freeMem
  delete this.location
}

Context.prototype.setLocalNR = function(localNR) {
  this.deviceId = localNR.deviceId
  this.deviceName = localNR.deviceName
  if (localNR.location){
    this.location = localNR.location
  }
}

Context.prototype.snapshot = function() {
  let location = null
  // snapshoting
  this.location = location || this.location
  this.freeMem = os.freemem()/1000000 // bytes to MB
}

Context.prototype.query = function() {
  return {
    location: this.location,
    freeMem: this.freeMem,
    cores: this.cores
  }
}

// "constraints":{"link":{},"In Vancouver, BC":{"id":"In Vancouver, BC","fill":"#25c6a1","text":"In Vancouver, BC"}}
Context.prototype.satisfying = function(constraints) {
  // AND all constraints together
  for (var cid in constraints){
    if (cid === 'link'){
      continue
    }

    for (let cElement in constraints[cid]){
      if (cElement === 'id' ||
          cElement === 'fill' ||
          cElement === 'text'){
        continue
      }

      if (cElement === 'deviceName'){
        if (!this.deviceName ||
            this.deviceName !== constraints[cid][cElement]){
          return false
        }
      }

      if (cElement === 'cores'){
        if (!this.cores ||
            this.cores < constraints[cid][cElement]){
          return false
        }
      }

      if (cElement === 'location'){
        if (!this.location){
          return false
        }
        let locationConstraint = JSON.parse(constraints[cid][cElement])
        return utils.geoInclude(this.location, locationConstraint)
      }

      if (cElement === 'memory' && 
          this.freeMem < constraints[cid][cElement]){
        return false
      }
    }
  }

  return true
}

/*
  need to decide how this dnr node should behave.
  this includes:
  1. should it fetch data from outside and forward to next node (FETCH_FORWARD)
  2. should it receive data and redirect to external node (RECEIVE_REDIRECT)
  3. should it receive data and drop the message (DROP)
  4. should it receive data and forward to next node (NORMAL)

  1 means aNode was skipped by a dnr node preceeds it
  (aNode never sends any data to dnrNode)

  it should drop if aNode doesn't have any constraint (all devices have aNode running)

  aNode ------ dnrNode ----- cNode
  
  NORMAL state:

    aNode ------dnr-----> cNode

  DROP state:

    aNode ------dnr       cNode

  FETCH_FORWARD state:
 
        external               
              \                
               \               
    aNode       \______\  cNode
                       / 

  COPY_FETCH_FORWARD state:
 
        external               
              \                
               \               
    aNode ______\______\  cNode

  RECEIVE_REDIRECT state:
  
                  _ external
                  /|
                 /
    aNode ______/         aNode

  RECEIVE_REDIRECT_COPY state:
  
                  _ external
                  /|
                 /
    aNode ______/_______\  aNode
*/
Context.NORMAL = 1
Context.DROP = 2
Context.FETCH_FORWARD = 3
Context.RECEIVE_REDIRECT = 4
Context.COPY_FETCH_FORWARD = 5
Context.RECEIVE_REDIRECT_COPY = 6


Context.prototype.reason = function(aNode, cNode, linkType) {
  if (!utils.hasConstraints(aNode)){
    // should be receiving from aNode
    // decide if it should drop or send
    // should not redirect because all participating devices have aNode running
    if (!this.satisfying(cNode.constraints)){
      return Context.DROP
    } else {
      if (linkType === '1N'){
        return Context.RECEIVE_REDIRECT_COPY
      } else if (linkType === 'N1'){
        return Context.COPY_FETCH_FORWARD
      } else {
        return Context.NORMAL
      }
    }
  }

  if (this.satisfying(aNode.constraints)){
    // should be receiving from aNode
    // decide if it should send or redirect to external node
    if (!utils.hasConstraints(cNode) || 
        this.satisfying(cNode.constraints)){
      if (linkType === '1N'){
        return Context.RECEIVE_REDIRECT_COPY
      } else if (linkType === 'N1'){
        return Context.COPY_FETCH_FORWARD
      } else {
        return Context.NORMAL
      }
    } else {
      return Context.RECEIVE_REDIRECT
    }
  }

  // not receiving anything from aNode
  if (utils.hasConstraints(cNode) &&
      !this.satisfying(cNode.constraints)){
    return Context.DROP // should be another state: DO_NOTHING, but DROP would do well
  }

  return Context.FETCH_FORWARD
};

module.exports = {
  Context: Context
}//new Context()