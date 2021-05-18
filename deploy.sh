#!/bin/bash

echo What should the version be?
read VERSION

sudo docker build -t devleeon/lireddit:$VERSION .
sudo docker push devleeon/lireddit:$VERSION
ssh root@139.59.124.207 "docker pull devleeon/lireddit:$VERSION && docker tag devleeon/lireddit:$VERSION dokku/api:$VERSION && dokku deploy api $VERSION"