// main file loads all the other dependencies.

// initialize the global MODULE
window.safeComments = {}

const loaderElement = document.getElementById("comments-loader")
const rootPath = loaderElement ? loaderElement.src.replace(/main\.js(.?)$/, '') : './comments/'
const libsPath = "vendor/"
const head = document.getElementsByTagName("head")[0]

console.log(rootPath)

function _makeCSSLoader(path) {
  var elem = document.createElement("link")
  elem.setAttribute("rel", "stylesheet")
  elem.setAttribute("type", "text/css")
  elem.setAttribute("href", rootPath + path)
  return elem
}

function _makeJSLoader(path) {
  var elem = document.createElement('script')
  elem.setAttribute("type","text/javascript")
  elem.setAttribute("src", rootPath + path)
  return elem
}

const elements = [
  // CSS
  // external dependencies
  libsPath + 'bootstrap-v3.3.7.min.css',

  // local files
  'style/comments-tutorial.css'

].map(_makeCSSLoader).concat([
  // Javascript
  // external dependencies
  libsPath + 'jquery-3.1.1.min.js',

  // local files
  'src/helpers.js',
  'src/model.js',
  'src/view.js',
  'src/controller.js',
  'src/app.js'
].map(_makeJSLoader))


elements.map(head.appendChild.bind(head))