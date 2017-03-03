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
var TOPIC_REGISTER_REQ = 'register_req'
var TOPIC_DNR_SYN_REQ = dnrInterface.TOPIC_DNR_SYN_REQ
var TOPIC_DNR_SYN_RES = dnrInterface.TOPIC_DNR_SYN_RES
var TOPIC_DNR_SYN_RESS = dnrInterface.TOPIC_DNR_SYN_RESS
var TOPIC_FLOW_DEPLOYED = dnrInterface.TOPIC_FLOW_DEPLOYED

var STATE_CONNECTING = 0
var STATE_CONNECTED = 1
var STATE_REGISTERING = 2
var STATE_REGISTERED = 3

var STATE_DISCONNECTING = -1
var STATE_DISCONNECTED = -2
var STATE_SERVER_INACTIVE = -3
var STATE_SERVER_UNREACHABLE = -4

var OPERATOR_HEARTBEAT = 5000
const OPERATOR_INACTIVE = 15000*3

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
      return flowsApi.getNodes()
    })
    .then((nodes)=>{
      nodes = JSON.parse(nodes)

      let localNodeTypes = []
      for (let n of nodes){
        let nTypes = n.types
        localNodeTypes = localNodeTypes.concat(n.types)
      }

      localNR.localNodeTypes = localNodeTypes

      that.connect()
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
    
    // send hb to server
    this.log('agent state - ' + this.state)

    if (this.state == STATE_REGISTERED){
      this.getWs().send(JSON.stringify({
        topic:TOPIC_DNR_HB, 
        deviceId: this.getLocalNR().deviceId,
        context: this.getContext().query(),
        dnrSyncReqs: this.dnrSyncReqs
      }))

      if (this.lastServerHb && Date.now() - this.lastServerHb >= OPERATOR_INACTIVE){
        this.state = STATE_SERVER_INACTIVE
        this.reconnect()
      }
    }
  }

  DnrDaemonNode.prototype.processUnknownNodes = function(activeFlow) {
    for (let n of activeFlow.nodes){
      if (!this.getLocalNR().localNodeTypes.includes(n.type)){
        this.log('adding placeholder node for missing type: ' + n.type)
        n.replaceFor = n.type
        n.type = 'dnr-placeholder'
        n.outputs = n.wires.length
        n.constraints = {'no-run':{id: 'no-run', cores:999999}}
      }
    }

    if (activeFlow.configs){
      let cIndex = activeFlow.configs.length
      while(cIndex--){
        let n = activeFlow.configs[cIndex]
        if (!this.getLocalNR().localNodeTypes.includes(n.type)){
          this.log('removing config node whose type is missing: ' + n.type)
          activeFlow.configs.splice(cIndex, 1)
        }
      }
    }
  }

  DnrDaemonNode.prototype.register = function() {
    if (this.state !== STATE_CONNECTED){
      return
    }
    if (this.getWs().readyState !== 1){
      return
    }

    this.getWs().send(JSON.stringify({
      'topic':TOPIC_REGISTER,
      'deviceName' : this.getLocalNR().deviceName
    }))

    this.state = STATE_REGISTERING
  }

  DnrDaemonNode.prototype.connect = function() {
    let path = this.getOperatorUrl() + 
      (this.getOperatorUrl().slice(-1) == "/"?"":"/") + 
      "dnr"

    this.setWs(new WebSocket(path.replace('http://', 'ws://').replace('https://', 'wss://')))

    var ws = this.getWs()
    this.log('connecting')
    let node = this
    ws.on('open', function() {
      node.setAttempt(0)
      node.setWsAlive(true)
      node.state = STATE_CONNECTED
      node.register.call(node)
    })

    ws.on('message', function(msg) {
      if (ws.readyState !== 1){
        return
      }

      node.lastServerHb = Date.now()
      try {
        // node.log(msg)
        msg = JSON.parse(msg)

        if (msg.topic === TOPIC_REGISTER_ACK){
          node.getLocalNR().deviceId = msg.id
          node.setRegistered(true)
          node.state = STATE_REGISTERED
        }

        if (msg.topic === TOPIC_REGISTER_REQ){
          node.state = STATE_CONNECTED
          node.register.call(node)
        }

        if (msg.topic === TOPIC_FLOW_DEPLOYED){
          let activeFlow = msg.data.activeFlow
          let masterFlows = msg.data.allFlows
          let globalFlow = msg.data.globalFlow

          node.processUnknownNodes(activeFlow)

          let dnrizedFlow = Dnr.dnrize(activeFlow)
          // hook to daemon from each dnr gateway
          for (let n of dnrizedFlow.nodes){
            if (n.type === 'dnr-gateway'){
              n.config.daemon = node.id
              n.config.brokerEndpoint = node.getOperatorUrl() + 
                (node.getOperatorUrl().slice(-1) == "/"?"":"/") + 
                "mqttws"
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

    ws.on('close', function(e,r){
      node.log('onclose ' + e + ' r: ' + r)
      node.state = STATE_SERVER_UNREACHABLE
      node.reconnect()
    })

    ws.on('error', function(e){
      node.log('error ' + e)
      node.state = STATE_SERVER_UNREACHABLE
      node.reconnect()
    })

    // function noConnection(closed) {
    //   node.setWsAlive(false)
    //   node.setRegistered(false)

    //   if (!node.isActive()){
    //     return
    //   }
    //   if (!closed){
    //     node.getWs().close()
    //     node.state = STATE_DISCONNECTING
    //     return
    //   }

    //   node.setAttempt(node.getAttempt()+1);
    //   node.log('reconnecting...')
    //   setTimeout(()=>node.connect.call(node),node.getAttempt() < 10 ? 2000 : 60000);
    // }
  }

  DnrDaemonNode.prototype.reconnect = function() {
    if (this.state !== STATE_SERVER_UNREACHABLE && 
        this.state !== STATE_SERVER_INACTIVE){
      return
    }
    if (!this.isActive()){
      return
    }
    if (this.getWs()){
      this.log('closing the old ws')
      this.getWs().close()
      this.setWs(null)
    }

    this.setAttempt(this.getAttempt()+1);
    let node = this
    node.log('scheduling reconnection...')
    if (node.reconnectTimer){
      clearTimeout(node.reconnectTimer)
    }
    node.reconnectTimer = setTimeout(function(){
      node.connect.call(node)
      node.state = STATE_CONNECTING
    },this.getAttempt() < 10 ? 2000 : 60000);
  }

  function NodeRedCredentialsNode(n) {
    RED.nodes.createNode(this,n);
    this.deviceName = n.deviceName
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
  RED.nodes.registerType("dnr-daemon", DnrDaemonNode, {})
  RED.nodes.registerType("nodered-credentials", NodeRedCredentialsNode, {
    credentials: {
      username: {type:"text"},
      password: {type:"password"}
    }
  })
  RED.nodes.registerType("operator-credentials", OperatorCredentialsNode, {
    credentials: {
      token: {type:"text"}
    }
  })
}
