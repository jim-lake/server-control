#!/bin/bash

if [ "$#" -lt 1 ]; then
    echo "Usage: $1 <hash> [revert_hash]"
    exit 1
fi

echo "Discard any local changes"
git checkout -f
echo "Checkout master"
git checkout -q master
if [ "$?" -ne 0 ]; then
    echo " - Checkout master failed."
    exit 1
fi

echo "Pulling latest."
git pull
if [ "$?" -ne 0 ]; then
    echo " - Pull failed."
    exit 1
fi
echo "Checking out hash $1."
git checkout -q $1
if [ "$?" -ne 0 ]; then
    echo " - Checkout failed."
    if [ "$2" != "" ]; then
        echo "Reverting to hash $2."
        git checkout -q $2
        if [ "$?" -ne 0 ]; then
            echo " - Revert failed!"
            exit 2
        fi
        echo " - Revert Success."
    fi
    exit 1
else
    git reset --hard
    npm ci
fi
exit 0
