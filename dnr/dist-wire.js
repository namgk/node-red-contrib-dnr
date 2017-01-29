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

module.exports = function(RED) {
  "use strict";

  function DnrNode(n){
    RED.nodes.createNode(this,n);
    var node = this;

    node.gateway = RED.nodes.getNode(n.gateway);
    if (!node.gateway){
      throw "No dnr gateway configured for this flow";
    }

    // node.input: "source_port"
    node.input = n.input;
    node.linkType = n.linkType
    node.state = node.gateway.context.NORMAL

    node.on('input', function(msg){
      node.gateway.dispatch(node, msg)
    })

    node.gateway.register(node);
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
    this.device = this.daemon.getLocalNR().deviceId
    this.flowCoordinator = this.daemon.getOperatorUrl()// TODO: should get this from flow meta-data

    for (var node of this.flow.nodes){
      this.nodesMap[node.id] = node
    }

    var gateway = this
    setInterval(function(){
      gateway.heartbeat.call(gateway)
    }, 5000)
  }

  DnrGatewayNode.prototype.heartbeat = function() {
    var dnrLinks = []
    var contextChanged = false

    // update the state of each dnr node according to device context
    for (var k in this.nodesMap){
      // aNode ------ dnrNode ----- cNode
      var cNode = this.nodesMap[k]
      var dnrNode = this.dnrNodesMap[cNode.id]
      if (!dnrNode){
        continue
      }
      var aNode = this.nodesMap[dnrNode.input.split('_')[0]]

      // need to decide how this dnr node should behave
      var state = this.context.reason(aNode, cNode)
      if (dnrNode.state === state){
        continue
      }

      contextChanged = true

      if (dnrNode.state === this.context.FETCH_FORWARD && 
        state !== this.context.FETCH_FORWARD){
        this.broker.unsubscribe(dnrNode)
      }

      dnrNode.state = state

      if (state === this.context.FETCH_FORWARD || 
          state === this.context.RECEIVE_REDIRECT){
        dnrLinks.push(dnrNode.input + cNode.id)
      }
    }

    if (!contextChanged){
      return
    }

    // fetch rounting table
    var opt = {
      baseUrl: this.flowCoordinator,
      uri: '/dnr/routingtable',
      method: 'POST',
      body: JSON.stringify(dnrLinks),
      headers: {
          'Content-type': 'application/json'
      }
    }
    request(opt)
    .then(function (body) {
      let response = JSON.parse(body)
      console.log(response)
    })
    .catch(function (er) {
      console.log({ error: er.error, statusCode: er.statusCode, statusMessage: er.message });
    });

    // update pub/sub topics
    // for (var k in this.nodesMap){
    //   var cNode = this.nodesMap[k]
    //   var dnrNode = this.dnrNodesMap[cNode.id]
    //   if (!dnrNode){
    //     continue
    //   }

    //   if (dnrNode.state === this.context.FETCH_FORWARD && 
    //     dnrNode.subscribeTopic){
    //     // fetch data from external node, aNode won't send anything!
    //     this.broker.subscribe(dnrNode.id, dnrNode.subscribeTopic, ((dnrNode) => {return function(msg){
    //       dnrNode.send(JSON.parse(msg))
    //     }})(dnrNode))
    //   }
    // }
  }

  DnrGatewayNode.prototype.register = function(dnrNode) {
    this.dnrNodesMap[dnrNode.wires[0][0]] = dnrNode
  }

  DnrGatewayNode.prototype.dispatch = function(dnrNode, msg) {
    switch (dnrNode.state) {
      case this.context.NORMAL:
        dnrNode.send(msg)
        break;
      case this.context.RECEIVE_REDIRECT:
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
