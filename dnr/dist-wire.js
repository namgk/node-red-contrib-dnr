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

module.exports = function(RED) {
    "use strict";

    function DNRNode(n){
        RED.nodes.createNode(this,n);
        var node = this;

        node.gateway = RED.nodes.getNode(n.gateway);
        node.input = n.input;
        node.output = n.wires[0][0];

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
            if (!this.nodesMap[node.id]){
                this.nodesMap[node.id] = node
            }
            if (node.type === 'dnr'){
                this.dnrNodesMap[node.wires[0][0]] = node
            }
        }
    }

    DnrGatewayNode.prototype.register = function(dnrNode) {
        let dnrFor = this.nodesMap[dnrNode.wires[0][0]]
        dnrNode.on('input', function(msg){
            if (utils.hasConstraints(dnrFor)){
                // TODO:
                console.log('skipping node that has unmet constraints ' + dnrNode.wires[0][0])
            } else {
                dnrNode.send(msg)
            }
        })
    }

    DnrGatewayNode.prototype.send = function(msg, dest) {
        this.broker.send(msg, dest)
    }

    RED.nodes.registerType("dnr",DNRNode);
    RED.nodes.registerType("dnr-gateway", DnrGatewayNode, {});
}
