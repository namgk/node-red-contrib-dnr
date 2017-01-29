"use strict";

var mqtt = require('mqtt')

function Broker(config){
  var broker = this
  broker.subscription = {} //  subscriber, topic, callback
  broker.topics = {}

  broker.client  = mqtt.connect('mqtt://localhost')
  broker.client.on('connect', function () {
    // client.subscribe('presence')
    // client.publish('presence', 'Hello mqtt')
  })

  broker.client.on('message', function (topic, message) {
    for (let k in broker.subscription){
      if (broker.subscription[k].topic === topic){
        broker.subscription[k].cb(message)
      }
    }
  })
}

Broker.prototype.subscribe = function(subscriber, topic, cb) {
	if (this.subscription[subscriber]) {
    // updating old topic
    let oldTopic = this.subscription[subscriber].topic
    if (oldTopic === topic){
      return
    }

    if (this.topics[oldTopic]){
      this.topics[oldTopic]--
    }
    if (this.topic[oldTopic] <= 0){
      this.client.unsubscribe(oldTopic)
    }
  }

  if (!this.topics[topic]){
    this.topics[topic] = 1
    this.client.subscribe(topic)
  } else {
    this.topics[topic]++
  }

  // either updating or create new
  this.subscription[subscriber] = {topic: topic, cb:cb}
}

Broker.prototype.unsubscribe = function(subscriber) {
  for (let k in this.subscription){
    if (k === subscriber){
      var topic = this.subscription[k].topic
      if (this.topics[topic]){
        this.topics[topic]--
        if (this.topic[topic] <= 0){
          this.client.unsubscribe(topic)
        }
      }
      delete this.subscription[k]
    }
  }
};

Broker.prototype.publish = function(publisher, topic, msg) {
	this.client.publish(topic, msg)
};

module.exports = Broker