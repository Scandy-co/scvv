var MinifyPlugin = require("babel-minify-webpack-plugin")
const CompressionPlugin = require("compression-webpack-plugin")
var webpack = require("webpack")
const pkg = require("./package.json")

const PORT = process.env.PORT || 3000

const production = process.env.NODE_ENV === "production"
process.env.PACKAGE_VERSION = `${pkg.version}`

// compress and optimize code for production
const PLUGINS = [
  new webpack.optimize.AggressiveMergingPlugin(),
  new CompressionPlugin(),
  new webpack.EnvironmentPlugin({
    PACKAGE_VERSION: `${pkg.version}`
    HOXEL_JS_CDN_URL: `https://hoxel-js-cdn.s3.us-east-2.amazonaws.com/releases`
  })
]

module.exports = {
  entry: {
    LoadSCVVWorker: "./lib/workers/LoadSCVVWorker.js",
    scvv: "./index.js"
  },
  output: {
    path: `${__dirname}/build/${pkg.version}/`,
    filename: `[name].js`,
    globalObject: "this"
  },
  mode: process.env.NODE_ENV || "development",
  watch: false,
  node: {
    fs: "empty" // fixes bug with Draco making reference to fs from node
  },
  optimization: {
    minimize: production,
    splitChunks: false
  },
  plugins: PLUGINS,
  module: {
    rules: [
      {
        test: /\.js/,
        exclude: /(node_modules)/,
        use: ["babel-loader"]
      }
    ]
  }
}
