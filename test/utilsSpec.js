var utils = require("../dnr/utils")
var chai = require("chai")
var expect = chai.expect

var testGeoInclusion = 
[
  {
    box:{"ne":[49.274874878571154,-123.04206848144531],"sw":[49.22826205090108,-123.211669921875]},
    point: {
      lat: 49.255883,
      lng: -123.156986
    },
    included: true
  },
  {
    box:{"ne":[27.547241546253268,-26.015625],"sw":[-30.883369321692257,-122.34375]},
    point: {
      lat: -6.175025,
      lng: -72.828392
    },
    included: true
  },
  {// across north pacific ocean
    box:{"ne":[51.57024144581124,-161.015625],"sw":[13.507155459536346,156.09375]},
    point: {
      lat: 33.561729, 
      lng: 178.029805
    },
    included: true
  },
  {
    box:{"ne":[-14.75363533154043,92.8125],"sw":[-60.66241476534367,-65.390625]},
    point: {
      lat: -36.259996, 
      lng: 20.561713
    },
    included: true
  },
  {// intersection of lat 0 and lon 180
    box:{"ne":[25.025884063244828,-117.421875],"sw":[-28.43971381702787,143.4375]},
    point: {
      lat: -5.197899,
      lng: -165.414851
    },
    included: true
  },
  {
    box:{"ne":[69.107776773315,146.953125],"sw":[46.45299704748289,52.03125]},
    point: {
      lat: 54.309803,
      lng: 75.165770
    },
    included: true
  },
  {// at lon 180
    box:{"ne":[-16.78350556192777,-104.0625],"sw":[-58.15911242952296,152.578125]},
    point: {
      lat: -33.852169,
      lng: -170.332026
    },
    included: true
  },
  {
    box:{"ne":[25.025884063244828,-117.421875],"sw":[-28.43971381702787,143.4375]},
    point: {
      lat: 28.673482,
      lng: -49.047662
    },
    included: false
  },
  {
    box:{"ne":[69.107776773315,146.953125],"sw":[46.45299704748289,52.03125]},
    point: {
      lat: 51.116982,
      lng: -38.740482
    },
    included: false
  }
]


describe("geoInclude", function() {
    for (let i = 0 ; i < testGeoInclusion.length; i++){
      let test = testGeoInclusion[i]
      it("decides if point is included in box " + i, function() {
        let box = test.box
        let point = test.point
        expect(test.included).to.equal(utils.geoInclude(point, box))
      })
    }
})