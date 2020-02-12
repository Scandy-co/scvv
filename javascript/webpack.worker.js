var MinifyPlugin = require("babel-minify-webpack-plugin")
const CompressionPlugin = require("compression-webpack-plugin")
const CopyWebpackPlugin = require("copy-webpack-plugin")
var fs = require("fs")
var ip = require("ip")
var path = require("path")
var webpack = require("webpack")
const HtmlWebPackPlugin = require("html-webpack-plugin")

const PORT = process.env.PORT || 3000

const production = process.env.NODE_ENV === "production"

// compress and optimize code for production
const PLUGINS = [
  new webpack.optimize.AggressiveMergingPlugin(),
  new CompressionPlugin()
]

module.exports = {
  entry: {
    LoadSCVVWorker: "./lib/workers/LoadSCVVWorker.js",
    scvv: "./src/components/scvv.js"
  },
  output: {
    path: `${__dirname}/build`,
    filename: `[name].js`,
    // filename: `[name].${version}.js`,
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
        use: ["babel-loader", "aframe-super-hot-loader"]
      },
      {
        // Handle the Draco web assembly code
        test: /\.(wasmbin)$/,
        use: [
          {
            loader: "url-loader",
            options: {
              limit: 340000
            }
          }
        ]
      }
    ]
  }
}
