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

var Auth = require("dnr-daemon").Auth
var FlowsAPI = require("dnr-daemon").FlowsAPI
var Ws = require("ws");

function getListenPath(settings) {
  var listenPath = 'http'+(settings.https?'s':'')+'://'+
                  (settings.uiHost == '0.0.0.0'?'127.0.0.1':settings.uiHost)+
                  ':'+settings.uiPort;
  if (settings.httpAdminRoot !== false) {
      listenPath += settings.httpAdminRoot;
  } else if (settings.httpStatic) {
      listenPath += "/";
  }
  return listenPath;
}

module.exports = function(RED) {
  "use strict";

  function DnrDaemonNode(n) {
    RED.nodes.createNode(this,n);

    var node = this;
    node.nodered = RED.nodes.getNode(n.nodered);
    node.operator = n.operator
    node.noderedPath = getListenPath(RED.settings)

    var auth = new Auth(
      node.noderedPath, 
      node.nodered? node.nodered.username : '',
      node.nodered? node.nodered.password : ''
    )

    auth.probeAuth().then(r=>{
      node.flowsApi = new FlowsAPI(auth)
    }).catch(function(e){
      auth.auth().then(r=>{
        node.flowsApi = new FlowsAPI(auth)
      }).catch(e=>{
        node.warn('cannot authenticate with local Node RED ' + e)
      })
    })

    node.wsClient = new Ws(node.operator + (node.operator.slice(-1) == "/"?"":"/") + "comms")
    node.wsClient.on('open', ()=>{
      console.log('comms connected')
    })
    node.wsClient.on('message', (msg)=>{
      console.log(msg)
    })
    node.wsClient.on('error', (err)=>{
      node.warn(err)
    })

    // node.on("input",function(msg) {
    // })
    
    // setInterval(function(){
    //   node.heartbeat.call(node)
    // }, 5000)
  }

  DnrDaemonNode.prototype.heartbeat = function() {
  }

  function NodeRedCredentialsNode(n) {
    RED.nodes.createNode(this,n);
    var node = this;

    if (node.credentials) {
      node.username = node.credentials.username;
      node.password = node.credentials.password;
    }
  }

  RED.nodes.registerType("dnr-daemon", DnrDaemonNode, {});

  RED.nodes.registerType("nodered-credentials", NodeRedCredentialsNode, {
    credentials: {
      username: {type:"text"},
      password: {type:"text"}
    }
  });

  RED.httpAdmin.post("/dnr_daemon/:id", RED.auth.needsPermission("dnrdaemon.trigger"), function(req,res) {
    var node = RED.nodes.getNode(req.params.id);
    if (node != null) {
      try {
          node.receive({payload:'test daemon'});
          res.sendStatus(200);
      } catch(err) {
          res.sendStatus(500);
          node.error(RED._("dnr_daemon.failed",{error:err.toString()}));
      }
    } else {
        res.sendStatus(404);
    }
  });
}
