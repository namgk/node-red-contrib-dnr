function Broker(config){
  this.subscription = {} //  subscriber, topic, callback
  this.topics = {}
}

Broker.prototype.subscribe = function(subscriber, topic, cb) {
	if (!this.subscription[subscriber]){
    this.subscription[subscriber] = {topic: topic, cb:cb}
  }
  if (!this.topics[topic]){
    this.topics[topic] = 1
  } else {
    this.topics[topic]++
  }
};

Broker.prototype.unsubscribe = function(subscriber) {
  for (let k in this.subscription){
    if (k === subscriber){
      var topic = this.subscription[k].topic
      if (this.topics[topic]){
        this.topics[topic]--
      }
      delete this.subscription[k]
    }
  }
};

Broker.prototype.publish = function(publisher, topic, msg) {
	// body...
};

module.exports = Broker