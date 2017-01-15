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
var WebSocket = require("ws");

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

    this.reconnectAttempts = 0;
    this.active = true;
    this.connectCountdown = 10;
    this.ws = null

    var node = this;
    node.nodered = RED.nodes.getNode(n.nodered);
    node.operator = RED.nodes.getNode(n.operator)
    node.operatorUrl = n.operatorUrl
    node.noderedPath = getListenPath(RED.settings)

    console.log(node.operator)

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

    node.connectWS()

    node.on("close",function() {
      node.active = false
    })
    
    // setInterval(function(){
    //   node.heartbeat.call(node)
    // }, 5000)
  }

  DnrDaemonNode.prototype.heartbeat = function() {
  }

  DnrDaemonNode.prototype.connectWS = function() {
    let node = this

    let path = node.operatorUrl + 
      (node.operatorUrl.slice(-1) == "/"?"":"/") + 
      "dnr"

    node.ws = new WebSocket(path);

    node.ws.on('open', function() {
      node.reconnectAttempts = 0;
    })

    node.ws.on('message', function(msg) {
      console.log(msg)
    });

    node.ws.on('close', noConnection)

    node.ws.on('error', noConnection)

    function noConnection(e) {
      if (!node.active){
        return
      }

      node.ws.close()

      node.reconnectAttempts++;

      if (node.reconnectAttempts < 10) {
        console.log('reconnecting to dnr operator')
        setTimeout(()=>node.connectWS.call(node),2000);
      } else {
        node.connectCountdownTimer = setInterval(function() {
          console.log('reconnecting to dnr operator after 1 minute')
          clearInterval(node.connectCountdownTimer);
          node.connectWS.call(node);
        },1000*60);
      }
    }
  }

  function NodeRedCredentialsNode(n) {
    RED.nodes.createNode(this,n);
    var node = this;

    if (node.credentials) {
      node.username = node.credentials.username;
      node.password = node.credentials.password;
    }
  }

  function OperatorCredentialsNode(n) {
    RED.nodes.createNode(this,n);
    var node = this;

    if (node.credentials) {
      node.token = node.credentials.token;
    }
  }

  RED.nodes.registerType("dnr-daemon", DnrDaemonNode, {});

  RED.nodes.registerType("nodered-credentials", NodeRedCredentialsNode, {
    credentials: {
      username: {type:"text"},
      password: {type:"text"}
    }
  });

  RED.nodes.registerType("operator-credentials", OperatorCredentialsNode, {
    credentials: {
      token: {type:"text"}
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
