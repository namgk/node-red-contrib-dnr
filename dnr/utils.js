module.exports = {
	hasConstraints: function(node){
		return node.constraints && Object.keys(node.constraints).length > 0
	}
}