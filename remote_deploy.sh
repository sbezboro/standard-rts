#!/bin/bash
#the following commands are run on the remote host for the deploy process

node_dir="/home/sbezboro/standard-rts"

cd $node_dir
git pull
npm install
supervisorctl restart standard-rts