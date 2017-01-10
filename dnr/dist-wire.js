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
var context = require("./context");
var Broker = require('./broker');

module.exports = function(RED) {
  "use strict";

  function DNRNode(n){
    RED.nodes.createNode(this,n);
    var node = this;

    node.gateway = RED.nodes.getNode(n.gateway);
    node.input = n.input;
    node.state = context.NORMAL

    node.on('input', function(msg){
      node.gateway.dispatch(node, msg)
    })

    node.gateway.register(node);
  }


  function DnrGatewayNode(n) {
    RED.nodes.createNode(this,n);
    this.config = n.config
    this.broker = new Broker(this.config)
    this.flow = this.config.flow
    this.nodesMap = {}
    this.dnrNodesMap = {} // key: a normal node, value: the dnr node preceed it
    
    for (var node of this.flow.nodes){
      this.nodesMap[node.id] = node
    }

    var gateway = this
    setInterval(function(){
      gateway.heartbeat.call(gateway)
    }, 5000)
  }

  DnrGatewayNode.prototype.heartbeat = function() {
    for (var k in this.nodesMap){
      // aNode ------ dnrNode ----- cNode
      var cNode = this.nodesMap[k]
      var dnrNode = this.dnrNodesMap[cNode.id]
      if (!dnrNode){
        continue
      }
      var aNode = this.nodesMap[dnrNode.input.split('_')[0]]

      /*
        need to decide how this dnr node should behave
      */
      var state = context.reason(aNode, cNode)
      if (dnrNode.state === state){
        return
      }

      dnrNode.state = state

      if (state === context.FETCH_FORWARD){
        // fetch data from external node, aNode won't send anything!
        // dnrNode.input: 'nodeId_outport'
        var topic = dnrNode.input
        this.broker.subscribe(dnrNode.id, topic, ((dnrNode) => {return function(msg){
          dnrNode.send(JSON.parse(msg))
        }})(dnrNode))
      } else {
        this.broker.unsubscribe(dnrNode)
      }
    }
  }

  DnrGatewayNode.prototype.register = function(dnrNode) {
    this.dnrNodesMap[dnrNode.wires[0][0]] = dnrNode
  }

  DnrGatewayNode.prototype.dispatch = function(dnrNode, msg) {
    switch (dnrNode.state) {
      case context.NORMAL:
        dnrNode.send(msg)
        break;
      case context.RECEIVE_REDIRECT:
        var topic = dnrNode.input
        this.broker.publish(dnrNode, topic, JSON.stringify(msg))
        break;
      case context.FETCH_FORWARD:
        break;
      default:
        // context.DROP
        console.log('skipping node that has unmet constraints ' + dnrNode.wires[0][0])
    }
  }

  RED.nodes.registerType("dnr-gateway", DnrGatewayNode, {});
  RED.nodes.registerType("dnr", DNRNode);
}
