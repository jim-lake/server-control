#!/bin/bash
source <( curl "http://169.254.169.254/latest/user-data" 2>/dev/null ) 
 
if [ "${NODE_GIT_HASH}" != "" ]; then
  pushd $PROJECT_DIR >/dev/null 2>/dev/null
  su node -c "node_modules/server-control/git_update_to_hash.sh ${NODE_GIT_HASH}" >>/tmp/instance-update.log 2>&1
  popd >/dev/null 2>/dev/null
  /usr/bin/supervisorctl restart all
fi

