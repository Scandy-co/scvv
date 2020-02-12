yarn workers
ret=$?

if [ $ret -ne 0 ]; then
  echo "`yarn workers` failed"
  exit $ret
fi

aws s3 cp --acl='public-read' build/scvv.js s3://hoxel-streamed-001/
aws s3 cp --acl='public-read' build/LoadSCVVWorker.js s3://hoxel-streamed-001/
