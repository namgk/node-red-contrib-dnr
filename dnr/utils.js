
//TODO: edge cases: lat 0, lon 180
function geoInclude (point, box){
  /* box
      {"ne":[lat, lng],
      "sw":[lat, lng]}
      */
  let pointFlat = geoFlat(point.lat, point.lng)
  let neFlat = geoFlat(box.ne[0], box.ne[1])
  let swFlat = geoFlat(box.sw[0], box.sw[1])

  return pointFlat.x >= swFlat.x && pointFlat.x <= neFlat.x &&
          pointFlat.y >= neFlat.y && pointFlat.y <= swFlat.y
}

function geoFlat (lat, lon){
  var y = ((-1 * lat) + 90) * (500 / 180);
  var x = (lon + 180) * (500 / 360);
  return {x:x,y:y};
}

module.exports = {
	hasConstraints: function(node){
		return node.constraints && Object.keys(node.constraints).length > 0
	},
  generateId: function () {
    return (1+Math.random()*4294967295).toString(16);
  },
  geoInclude: geoInclude,
  geoFlat: geoFlat
}