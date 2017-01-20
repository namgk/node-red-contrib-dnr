# node-red-contrib-dnr

This node package helps connect a Node RED instance to a cluster of Node RED instances that belong to a Distributed Node RED (DNR) flow.

It contains a "DNR daemon" node and a "dnr" node. DNR Daemon node connects to a DNR Editor <https://github.com/namgk/dnr-editor>, a specialized Node RED that is used as a DNR Flow editor. DNR Daemon listens to newly deployed flows from DNR Editor, downloads the flows, turn them into DNR-enabled flows and deploy the later to the local Node RED where it is run.

A sample Distributed Node RED flow:

[![DNR Flow](https://snag.gy/Sm9utG.jpg)]

When this flow is DNR-ized, it becomes:

[![DNR-ized Flow](https://snag.gy/TLzaP9.jpg)]

The small connecting nodes are "dnr" nodes that intercept messages among nodes in Node RED. They check if the destination node satisfies the deployment constraints and decide to forward, drop, or redirect the message to appropriate nodes in other Node RED instances.

## How to deploy

Install DNR Editor at <https://github.com/namgk/dnr-editor> to a dedicated machine (e.g a Cloud server).

Install this node package in every participating Node RED instances.

Configure and deploy one "DNR Daemon" node per each instances so that they point to your DNR Editor as a DNR Operator (DNR Operator URL). Configure appropriate credentials for these "DNR Daemon" nodes so that they have the authorization to install flows to the Node RED instances they are running on.

Once this is done, the participating Node RED instances will peridically update their status to the DNR Editor via websocket connections.
