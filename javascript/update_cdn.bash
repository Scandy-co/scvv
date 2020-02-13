

rm -rf build/*

yarn workers >/dev/null 2>&1
ret=$?

if [ $ret -ne 0 ]; then
  echo "`yarn workers` failed"
  exit $ret
fi


# version=$(cat package.json | grep '"version":' | awk '{print $2}' | awk -F '"' '{print $2}')
version=$(ls build)

echo "`yarn workers` finished building $version"

aws s3 sync --acl='public-read' build/$version s3://hoxel-js-cdn/releases/$version
aws s3 sync --acl='public-read' build/$version s3://hoxel-js-cdn/releases/latest
