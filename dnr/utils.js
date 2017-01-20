module.exports = {
	hasConstraints: function(node){
		return node.constraints && Object.keys(node.constraints).length > 0
	},
  generateId: function () {
    return (1+Math.random()*4294967295).toString(16);
  }
}