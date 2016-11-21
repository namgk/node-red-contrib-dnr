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

var utils = require("./utils");

function Context(){
  this.NORMAL = 1
  this.DROP = 2
  this.FETCH_FORWARD = 3
  this.RECEIVE_REDIRECT = 4

}

Context.prototype.satisfying = function(constraints) {
  return false
};

// aNode ------ dnrNode ----- cNode
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
*/
Context.prototype.reason = function(aNode, cNode) {
  if (!utils.hasConstraints(aNode)){
    // should be receiving from aNode
    // decide if it should drop or send
    // should not redirect because all participating devices have aNode running
    if (!this.satisfying(cNode.constraints)){
      return this.DROP
    } else {
      return this.NORMAL
    }
  }

  if (this.satisfying(aNode.constraints)){
    // should be receiving from aNode
    // decide if it should send or redirect to external node
    if (!utils.hasConstraints(cNode) || 
        this.satisfying(cNode.constraints)){
      return this.NORMAL
    } else {
      return this.RECEIVE_REDIRECT
    }
  }

  // not receiving anything from aNode
  if (utils.hasConstraints(cNode) &&
      !this.satisfying(cNode.constraints)){
    return this.DROP // should be another state: DO_NOTHING, but DROP would do well
  }

  return this.FETCH_FORWARD
};

module.exports = new Context()