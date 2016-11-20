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

var util = require("util");
var Broker = require('./broker');

function generateId() {
    return (1+Math.random()*4294967295).toString(16);
}

module.exports = function(RED) {
    "use strict";

    function DNRNode(n){
        RED.nodes.createNode(this,n);
        var node = this;

        node.gateway = RED.nodes.getNode(n.gateway);
        node.input = n.input;
        node.output = n.wires[0][0];

        util.log('[info] [dnr] DNRNode created for node ' + n.id + ' (' + n.type + ')');

        // to get data from external device
        if (node.input){
            node.gateway.register(n.id, node.input, function(data){
                if (data)
                    node.send(data.payload ? data : {payload:data});
            });
        }

        // to send data out, it doesn't make sense if 
        // there isn't output but still receive input
        if (node.output){
            node.on('input', function(msg){
                if (msg)
                    node.gateway.send(msg, node.output);
            })
        }
    }

    RED.nodes.registerType("dnr",DNRNode);

    function DnrGatewayNode(n) {
        RED.nodes.createNode(this,n);
        this.broker = new Broker(n.config)
        this.routing = {};
    }

    DnrGatewayNode.prototype.register = function(nodeId, topic, cb) {
        if (this.routing[topic]){
            this.routing[topic][nodeId] = cb
        } else {
            this.routing[topic] = {nodeId: cb}
            var routingTable = this.routing[topic]
            this.broker.subscribe(topic, function(data){
                for (var nodeId in routingTable){
                    routingTable[nodeId](data)
                }
            })
        }
    };

    DnrGatewayNode.prototype.send = function(msg, dest) {
        this.broker.send(msg, dest)
    };

    RED.nodes.registerType("dnr-gateway", DnrGatewayNode, {});
}
