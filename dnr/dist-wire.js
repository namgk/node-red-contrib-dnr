/**
 * Copyright 2014 Sense Tecnic Systems, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

var utils = require("./utils");
var Broker = require('./broker');
var request = require("request-promise-native");
var dnrInterface = require('dnr-interface')
var ctxConstant = dnrInterface.Context
var RoutingTableRes = dnrInterface.RoutingTableRes

module.exports = function(RED) {
  "use strict";

  function DnrNode(n){
    RED.nodes.createNode(this,n);
    var node = this;

    node.gateway = RED.nodes.getNode(n.gateway);
    if (!node.gateway){
      throw "No dnr gateway configured for this flow";
    }

    // node.input: "sourceId_port"
    node.input = n.input;
    node.linkType = n.linkType || 'NN'
    node.state = ctxConstant.NORMAL

    node.on('input', function(msg){
      node.gateway.dispatch(node, msg)
    })

    node.on('close', function(){
      node.gateway.broker.unsubscribe(node.id)
    })

    node.gateway.register(node);
  }

  DnrNode.prototype.stateUpdate = function(state) {
    this.state = state
    switch (state) {
      case ctxConstant.FETCH_FORWARD:
        this.status({fill:"blue",shape:"dot",text:"FF >- " + this.subscribeTopic});
        break;
      case ctxConstant.RECEIVE_REDIRECT:
        this.status({fill:"yellow",shape:"dot",text:"RR -> " + this.publishTopic});
        break;
      case ctxConstant.NORMAL:
        this.status({});
        break;
      case ctxConstant.DROP:
        this.status({fill:"grey",shape:"dot",text:"DRP"});
        break;
    }

    if (state !== ctxConstant.FETCH_FORWARD){
      this.gateway.broker.unsubscribe(this.id)
    }
  }

  DnrNode.prototype.resubscribe = function(topic) {
    if (!topic){
      return
    }

    this.subscribeTopic = topic
    this.gateway.broker.subscribe(this.id, this.subscribeTopic, function(msg){
      this.send(JSON.parse(msg))
    }.bind(this))
  }

  // one per flow
  function DnrGatewayNode(n) {
    RED.nodes.createNode(this,n);
    this.config = n.config
    this.broker = new Broker(this.config)
    this.flow = this.config.flow
    this.nodesMap = {}
    this.dnrNodesMap = {} // key: a normal node, value: the dnr node preceed it
    this.daemon = RED.nodes.getNode(n.config.daemon)
    this.context = this.daemon.getContext()
    this.deviceId = this.daemon.getLocalNR().deviceId
    this.flowCoordinator = this.daemon.getOperatorUrl()// TODO: should get this from flow meta-data

    for (let node of this.flow.nodes){
      this.nodesMap[node.id] = node
    }

    this.hbClock = setInterval(function(){
      this.heartbeat()
    }.bind(this), 5000)

    this.on('close', function(){
      this.log('stopping hb')
      clearInterval(this.hbClock)
    }.bind(this))
  }

  DnrGatewayNode.prototype.heartbeat = function() {
    var dnrLinks = []
    var contextChanged = false

    // update the state of each dnr node according to device context
    for (let k in this.dnrNodesMap){
      // aNode ------ dnrNode ----- cNode
      let dnrNode = this.dnrNodesMap[k]
      let cNode = this.nodesMap[dnrNode.wires[0][0]]
      var aNode = this.nodesMap[dnrNode.input.split('_')[0]]

      // need to decide how this dnr node should behave
      var state = this.context.reason(aNode, cNode)

      if (dnrNode.state === state){
        continue
      }

      // update the pub/sub topics according to the state
      // there are several cases where daemons don't need to ask
      // for where they should send/fetch data to/from
      // e.g 
      //    if the link type is NN, the topic for pub/sub is 
      // always <srcId>_<srcPort>_<destId>
      //    if the link type is 1N and the dnrNode status is RECEIVE_REDIRECT,
      // the topic for publishing is always 
      //    "from_<myself>_<srcId>_<srcPort>_<destId>"
      //    similarly, if the link type is N1 and status is FETCH_FORWARD,
      // the topic for subscribing is always
      //    "to_<myself>_<srcId>_<srcPort>_<destId>"
      if (dnrNode.linkType === 'NN'){
        if (state === ctxConstant.FETCH_FORWARD){
          dnrNode.resubscribe(k)
        } else if (state === ctxConstant.RECEIVE_REDIRECT){
          dnrNode.publishTopic = k
        }
      }

      if (dnrNode.linkType === 'N1' && state === ctxConstant.FETCH_FORWARD){
        dnrNode.resubscribe('to_' + this.deviceId + '_'  + k)
      }

      if (dnrNode.linkType === '1N' && state === ctxConstant.RECEIVE_REDIRECT){
        dnrNode.publishTopic = 'from_' + this.deviceId + '_' + k
      }

      if ((dnrNode.linkType !== 'N1' && state === ctxConstant.FETCH_FORWARD) ||
          (dnrNode.linkType !== '1N' && state === ctxConstant.RECEIVE_REDIRECT)
        ){
        dnrLinks.push(dnrNode.input + '_' + cNode.id + '-' + state)
        // there is a context change and a need for updating the route table
        contextChanged = true
      }

      dnrNode.stateUpdate(state)
    }

    if (!contextChanged){
      return
    }

    // fetch rounting table
    var body = new dnrInterface.RoutingTableReq(
        this.deviceId, this.flow.id, dnrLinks
      ).toString()
    
    var opt = {
      baseUrl: this.flowCoordinator,
      uri: '/dnr/routingtable',
      method: 'POST',
      body: body,
      headers: {
        'Content-type': 'application/json'
      }
    }
    request(opt)
    .then(function (body) {
      let response = new RoutingTableRes().fromString(body)
      /* response should look like:
        {
          <link> : <topic>
        }
      */

      for (let link in response){
        // link: <src node Id>_<outport>_<dest node Id>
        // get the DNR node for this link
        let dnrNode = this.dnrNodesMap[link]
        if (!dnrNode){
          continue
        }

        // update its comm topics
        if (dnrNode.state === ctxConstant.FETCH_FORWARD){
          dnrNode.resubscribe(response[link])
        } else if (dnrNode.state === ctxConstant.RECEIVE_REDIRECT){
          dnrNode.publishTopic = response[link]
        }

        dnrNode.stateUpdate(dnrNode.state)
      }

    }.bind(this))
    .catch(function (er) {
      console.log({ error: er.error, statusCode: er.statusCode, statusMessage: er.message });
    });
  }

  DnrGatewayNode.prototype.register = function(dnrNode) {
    let key = dnrNode.input + '_' + dnrNode.wires[0][0]
    this.dnrNodesMap[key] = dnrNode
  }

  DnrGatewayNode.prototype.dispatch = function(dnrNode, msg) {
    switch (dnrNode.state) {
      case ctxConstant.NORMAL:
        dnrNode.send(msg)
        break;
      case ctxConstant.RECEIVE_REDIRECT:
        if (dnrNode.publishTopic){
          this.broker.publish(dnrNode, dnrNode.publishTopic, JSON.stringify(msg))
        }
        break;
      // skipping DROP context here
      // in case of FETCH_FORWARD, it won't receive 'input' event
      //   as it gets message from external nodes via subscription
    }
  }

  RED.nodes.registerType("dnr-gateway", DnrGatewayNode, {});
  RED.nodes.registerType("dnr", DnrNode);
}
