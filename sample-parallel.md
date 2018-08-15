## Running a parallel service using DNR

### Architecture               

    1                          in location x            1                      1
    +------------+   1-N      +-------------+    N-1    +----------+           +-----------+
    | http in    | +--------> |  processing | +-------> |  join    | +-------> | http out  |
    +------------+            +-------------+           +----------+           +-----------+


Processing node is done in parallel at all devices configured at location x. Results are joined and returned to client at device 1

### Implement

#### Idea

The idea is to run the http nodes in one device, say device 1 as in the sample flow. The requests are sent to two devices running in the configured location, thus creating a parallel run. The results are sent back to the original device (1) and are joined there. The final joined results are sent back to the client via http response node.

*device 1 and 2 are configured at location x
*http in node --> device 1
*processing node --> location x --> will be running at both the devices
*join node --> device 1, timer based --> join the result from devices at location x
*http out node --> device 1: send the joined results back to client

#### Enough talking

Register two devices to dnr-editor, name them 1 and 2. Configure their locations in order to use location constraint.

Import the sample-parallel.flow into dnr-editor.

The location constraint is named *bc*. Modify this constraint so that it encompasses the configured locations of both the two devices.

Deploy the flow.

Test the http in node:

curl -X GET http://<device 1>/yy?a=1

Should see the joined result: ["1","1"]

Try to turn of device 2 and run the test again, you should only see ["1"] as the result
