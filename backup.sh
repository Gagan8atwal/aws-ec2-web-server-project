#!/bin/bash

DATE=$(date +%F-%H-%M-%S)
FILE="backup-$DATE.txt"

echo "AWS practice backup created at $DATE" > $FILE

aws s3 cp $FILE s3://my-test-bucket-gagan/
