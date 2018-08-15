## Testing stateful node in DNR (e.g http nodes)

    1                         2                         1
    +------------+            +-------------+           +----------+
    | http in    | +--------> |  processing | +-------> | http out |
    +------------+            +-------------+           +----------+



Two devices and one dnr-editor

Register the two devices to the dnr-editor, name them 1 and 2

Import the stresstest.flow into the dnr-editor and deploy

Run stresstest.sh for testing.

The wrong count should be as small as possible, ideally 0.
