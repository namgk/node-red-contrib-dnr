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
var Dnr = require("dnr-daemon").Dnr
var FlowsAPI = require("dnr-daemon").FlowsAPI
var WebSocket = require("ws")
var ctx = require("./context")
var utils = require('./utils')

var dnrInterface = require('dnr-interface')
var TOPIC_DNR_HB = dnrInterface.TOPIC_DNR_HB
var TOPIC_REGISTER = dnrInterface.TOPIC_REGISTER
var TOPIC_REGISTER_ACK = dnrInterface.TOPIC_REGISTER_ACK
var TOPIC_DNR_SYN_REQ = dnrInterface.TOPIC_DNR_SYN_REQ
var TOPIC_DNR_SYN_RES = dnrInterface.TOPIC_DNR_SYN_RES
var TOPIC_DNR_SYN_RESS = dnrInterface.TOPIC_DNR_SYN_RESS
var TOPIC_FLOW_DEPLOYED = dnrInterface.TOPIC_FLOW_DEPLOYED

var OPERATOR_HEARTBEAT = 5000

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

  // there should be only one instance of this node throughout the local Node-RED
  function DnrDaemonNode(n) {
    RED.nodes.createNode(this,n);

    this.flowGateway = {} // dnrGatewayId --> {topic:<>, cb: func}
    this.dnrSyncReqs = {} // flowId --> dnrSyncReq

    var reconnectAttempts = 0
    var active = true
    var ws = null
    var wsAlive = false
    var registered = false

    var localNR = RED.nodes.getNode(n.nodered);
    var operatorUrl = n.operatorUrl
    var context = new ctx.Context()
    context.setLocalNR(localNR)
    // var operatorToken = RED.nodes.getNode(n.operatorToken) // not used

    this.log('DNR Operator: ' + operatorUrl)

    var flowsApi = null
    var auth = new Auth(
      getListenPath(RED.settings), 
      localNR.username,
      localNR.password
    )

    this.on("close",function() {
      active = false
      context.destroy()
      clearInterval(this.heartbeatTicker)
      if (ws){
        ws.close()
      }
    })
    
    this.getWs = function(){
      return ws
    }
    this.setWs = function(w){
      ws = w
    }
    this.isWsAlive = function(){
      return wsAlive
    }
    this.setWsAlive = function(a){
      wsAlive = a
    }
    this.getContext = function(){
      return context
    }
    this.getFlowApi = function(){
      return flowsApi
    }
    this.isActive = function(){
      return active
    }
    this.getAttempt = function(){
      return reconnectAttempts
    }
    this.setAttempt = function(a){
      reconnectAttempts = a
    }
    this.getOperatorUrl = function(){
      return operatorUrl
    }
    this.getLocalNR = function(){
      return localNR
    }
    this.isRegistered = function(){
      return registered
    }
    this.setRegistered = function(r){
      registered = r
    }

    let that = this
    auth.probeAuth()
    .catch(function(e){
      return auth.auth()
    })
    .then(r=>{
      flowsApi = new FlowsAPI(auth)
      that.connectWS()
      that.heartbeat()
      that.heartbeatTicker = setInterval((function(self){
        return function(){
          self.heartbeat.call(self)
        }
      })(that), OPERATOR_HEARTBEAT)
    })
    .catch(e=>{
      throw 'cannot authenticate with local Node RED ' + e
    })

  }

  DnrDaemonNode.prototype.heartbeat = function() {
    // triger heartbeat for all dnrGateway node
    for (let k in this.flowGateway){
      let gateway = this.flowGateway[k]
      let gatewayNode = RED.nodes.getNode(gateway)
      if (gatewayNode){
        gatewayNode.heartbeat()
      }
    }

    console.log(this.getContext().query())

    if (this.isWsAlive() && this.isRegistered()){
      this.getWs().send(JSON.stringify({
        topic:TOPIC_DNR_HB, 
        device: this.getLocalNR().deviceId,
        context: this.getContext().query(),
        dnrSyncReqs: this.dnrSyncReqs
      }))
    }

    // update the list of installed node types
    this.getFlowApi().getNodes()
    .then(function(nodes){
      nodes = JSON.parse(nodes)

      let localNodeTypes = []
      for (let n of nodes){
        let nTypes = n.types
        localNodeTypes = localNodeTypes.concat(n.types)
      }

      this.getLocalNR().localNodeTypes = localNodeTypes
    }.bind(this))
    .catch(e=>this.error(JSON.stringify(e)))
  }

  DnrDaemonNode.prototype.connectWS = function() {
    let path = this.getOperatorUrl() + 
      (this.getOperatorUrl().slice(-1) == "/"?"":"/") + 
      "dnr"

    this.log(path)

    this.setWs(new WebSocket(path))
    var ws = this.getWs()

    let node = this
    ws.on('open', function() {
      node.setAttempt(0)
      node.setWsAlive(true)

      ws.send(JSON.stringify({
        'topic':'register', 
        'device': node.getLocalNR().deviceId || utils.generateId()
      }))
    })

    ws.on('message', function(msg) {
      try {
        node.log(msg)
        msg = JSON.parse(msg)

        if (msg.topic === TOPIC_REGISTER_ACK){
          if (!msg.idOk){
            node.warn('duplicated device id found on cluster,\
                        using the assigned id ' + msg.id)
          }
          node.getLocalNR().deviceId = msg.id
          node.setRegistered(true)
        }

        if (msg.topic === TOPIC_FLOW_DEPLOYED){
          let activeFlow = msg.data.activeFlow
          let masterFlows = msg.data.allFlows
          let globalFlow = msg.data.globalFlow

          // TODO: deal with unknown node types
          // should replace unknown node types with dnr nodes
          // let missingTypeNodes = []
          for (let n of activeFlow.nodes){
            if (!node.getLocalNR().localNodeTypes.includes(n.type)){
              node.log('adding placeholder node for missing type: ' + n.type)
              n.replaceFor = n.type
              n.type = 'dnr-placeholder'
              n.outputs = n.wires.length
              n.constraints = {'no-run':{id: 'no-run', cores:999999}}
            }
          }

          let dnrizedFlow = Dnr.dnrize(activeFlow)
          // hook to daemon from each dnr gateway
          for (let n of dnrizedFlow.nodes){
            if (n.type === 'dnr-gateway'){
              n.config.daemon = node.id
              n.config.brokerEndpoint = node.getOperatorUrl()
              break
            }
          }

          let toBeUpdated = null
          let toBeDeleted = []

          // updating global flow that holds shared configs and subflows
          node.getFlowApi().getFlow('global')
          .then((localGlobalFlow)=>{
            localGlobalFlow = JSON.parse(localGlobalFlow)
            let oldLen = localGlobalFlow.configs.length

            for (let gc of globalFlow.configs){
              let exist = false
              for (let c of localGlobalFlow.configs){
                if (c.id === gc.id){
                  exist = true
                  c = gc
                  break
                }
              }
              if (!exist){
                localGlobalFlow.configs.push(gc)
              }
            }

            if (oldLen !== localGlobalFlow.configs.length){
              return node.getFlowApi().updateFlow('global', JSON.stringify(localGlobalFlow))
            }
          })
          // getting local flows to be updated or deleted
          .then(()=>{
            return node.getFlowApi().getFlows()
          })
          .then(flows=>{
            flows = JSON.parse(flows)

            for (var i = 0; i<flows.length; i++){
              if (!flows[i].label || !flows[i].label.startsWith('dnr_')){
                continue
              }

              let actualFlowId = flows[i].label.replace('dnr_','')

              // sync local flows with master flows
              if (masterFlows.indexOf(actualFlowId) == -1){
                toBeDeleted.push(node.getFlowApi().uninstallFlow(flows[i].id))
              } else if (actualFlowId === activeFlow.id){
                toBeUpdated = flows[i].id
              }
            }
          })
          .then(()=>{
            if (toBeUpdated){
              return node.getFlowApi().updateFlow(toBeUpdated, JSON.stringify(dnrizedFlow))
            } else {
              return node.getFlowApi().installFlow(JSON.stringify(dnrizedFlow))
            }
          })
          .then(()=>{
            // Node-RED bug: cannot concurrently delete flows
            // if (toBeDeleted.length > 0){
            //   return toBeDeleted.reduce(function(cur, next){
            //     return cur.then(next)
            //   })
            // }
          }).catch(node.error)
        }

        if (msg.topic === TOPIC_DNR_SYN_RESS){
          let resps = msg.dnrSync
          for (let resp of resps){
            let dnrSyncReq = resp.dnrSyncReq
            let dnrSyncRes = resp.dnrSyncRes
            let gateway = node.flowGateway[dnrSyncReq.flowId]
            let gatewayNode = RED.nodes.getNode(gateway)
            if(gatewayNode){
              gatewayNode.receive(dnrSyncRes)
            }

            delete node.dnrSyncReqs[dnrSyncReq.flowId]
          }
        }
      } catch (err){
        node.error(err)
      }
    })

    ws.on('close', noConnection)
    ws.on('error', noConnection)

    function noConnection(e) {
      node.setWsAlive(false)
      node.setRegistered(false)

      if (!node.isActive()){
        return
      }

      node.getWs().close()// rest assured, this won't trigger close event!

      node.setAttempt(node.getAttempt()+1);

      if (node.getAttempt() < 10) {
        node.log('reconnecting to dnr operator')
        setTimeout(()=>node.connectWS.call(node),2000);
      } else {
        node.connectCountdownTimer = setInterval(function() {
          node.log('reconnecting to dnr operator after 1 minute')
          clearInterval(node.connectCountdownTimer);
          node.connectWS.call(node);
        },1000*60);
      }
    }
  }

  function NodeRedCredentialsNode(n) {
    RED.nodes.createNode(this,n);
    this.deviceId = n.deviceId
    this.location = n.location

    if (this.credentials) {
      this.username = this.credentials.username;
      this.password = this.credentials.password;
    }
  }

  function OperatorCredentialsNode(n) {
    RED.nodes.createNode(this,n);

    if (this.credentials) {
      this.token = this.credentials.token;
    }
  }

  RED.nodes.registerType("dnr-daemon", DnrDaemonNode, {});

  RED.nodes.registerType("nodered-credentials", NodeRedCredentialsNode, {
    credentials: {
      username: {type:"text"},
      password: {type:"password"}
    }
  });

  RED.nodes.registerType("operator-credentials", OperatorCredentialsNode, {
    credentials: {
      token: {type:"text"}
    }
  });

  // RED.httpAdmin.post("/dnr_daemon/:id", RED.auth.needsPermission("dnrdaemon.trigger"), function(req,res) {
  //   var node = RED.nodes.getNode(req.params.id);
  //   if (node != null) {
  //     try {
  //         node.receive({payload:'test daemon'});
  //         res.sendStatus(200);
  //     } catch(err) {
  //         res.sendStatus(500);
  //         node.error(RED._("dnr_daemon.failed",{error:err.toString()}));
  //     }
  //   } else {
  //       res.sendStatus(404);
  //   }
  // });
}
