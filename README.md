## webpack 打包流程：

1.读取入口文件内容

2.分析入口文件，递归读取模块所依赖的文件内容，生成 AST 语法树

3.根据 AST 语法树，生成浏览器能够运行的代码
具体细节：
先配置好 webpack.config.js 文件，创建 add.js 和 minus.js 在 index.js 中引入：
add.js

```js
export default (a, b) => {
  return a + b;
};
```

minus.js:

```js
export const minus = (a, b) => {
  return a - b;
};
```

index.js:

```js
import add from "./add.js";
import { minus } from "./minus.js";
const sum = add(1, 2);
const division = minus(2, 1);
console.log(sum);
console.log(division);
```

index.html:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Document</title>
    <script src="../dist/main.js"></script>
  </head>
  <body></body>
</html>
```

核心类是 WebpackCompiler.js,在构造函数中先获取 entryPath,初始化钩子，plugins 可以设置在不同的编译阶段，先给 webpack 定义五个生命周期，并在 run 方法适当的时机嵌入，

```js
class WebpackCompiler {
  constructor(config) {
    this.config = config;
    this.depsGraph = {};
    this.root = process.cwd(); //当前项目地址
    this.entryPath = this.config.entry;
    //插件在这些生命周期中被调用
    this.hooks = {
      run: new tapable.SyncHook(),
      beforeCompile: new tapable.SyncHook(),
      afterCompile: new tapable.SyncHook(),
      afterPlugins: new tapable.SyncHook(),
      afterEmit: new tapable.SyncWaterfallHook(["hash"]),
    };
    const plugins = this.config.plugins;
    if (Array.isArray(plugins)) {
      plugins.forEach((plugin) => {
        //每个均是实例，调用实例上的一个方法即可，传入当前Compiler实例
        //plugin.run(this);
        plugin.apply.call(plugin, this);
      });
    }
    run() {
    //编译开始
    this.hooks.run.call(); //启动项目
    this.hooks.beforeCompile.call(); //编译前运行
    this.buildModule(this.entryPath);
    this.hooks.afterCompile.call(); //编译后运行
    this.outputFile();
    this.hooks.afterPlugins.call(); //执行完plugins后运行
    this.hooks.afterEmit.call(); //结束后运行
  }
  }
```

#### 关于 tapable

可以参考这篇文章：https://juejin.cn/post/6955421936373465118
webpack 插件时一种基于 Tapable 的钩子类型，它在特定时机触发钩子时会带上足够的上下文信息，插件定义的钩子回调中，与这些上下文背后的数据结构，接口产生 sideEeffect,进而影响到编译状态和后续流程
自定义一个插件：

```js
class MyPlugin {
  apply(compiler) {
    compiler.hooks.run.tap("myPlugin", (compilation) => {
      console.log("my plugin");
    });
  }
}
module.exports = MyPlugin;
```

compiler.hooks.run.tap,其中 run 为 tapable 仓库提供的钩子对象，为订阅函数，tap 用于注册回调,关于 tapable 钩子：
SyncHook:同步执行，无需返回值
SyncBailHook:同步执行，无需返回值，返回 undefined 终止
SyncWaterfallHook,同步执行，上一个处理函数的返回值时下一个的输入，返回 undefined 终止
SyncLoopHook:同步执行，订阅的处理函数有一个的返回值不是 undefined 就一直循环它
异步钩子：
AsyncSeriesHook:异步执行，无需返回值
AsyncParallelHook:异步并行钩子
AsyncSeriesBailHook:异步执行，无需返回值，返回 undefined 终止
...

#### 获取模块内容

```js
//获取源码，经过loader转换生成代码
  getSourceByPath(modulePath) {
    //console.log("path", modulePath);
    let content = fs.readFileSync(modulePath, "utf8");
    //拿module中的匹配规则与路径进行匹配
    const rules = this.config.module.rules;
    for (let i = 0; i < rules.length; i++) {
      let { test, use } = rules[i];
      let len = use.length;
      //匹配到了开始走loader,从后往前
      if (test.test(modulePath)) {
        function changeLoader() {
          //先拿最后一个loader
          let loader = require(use[--len]);
          content = loader(content);
          if (len > 0) {
            changeLoader();
          }
        }
        changeLoader();
      }
    }
    return content;
  }
```

#### 分析模块和收集依赖

根据模块被 loader 编译后的内容和路径解析生成 ast 树，这里用@babel/paser 引入模块内容，用到一个选项 sourceType,设置为 module,表示我们要解析的是 ES 模块

遍历 ast 收集依赖，就是用 import 语句引入的文件路径收集起来，将收集起来的路径转换为绝对路径放到 deps 里，遍历 AST 用@babel/traverse 依赖包，第一个参数是 AST，第二个参数是配置对象，最后 ES6 转为 ES5 用@babel/core 和@babel/preset-env

```js
//根据路径解析源码,file是入口路径
  parse(source, file) {
    let ast = parser.parse(source, {
      sourceType: "module", //解析的是ES5模块
    });
    //console.log(ast);
    //收集依赖
    let dependencies = {};
    traverse(ast, {
      //获取通过Import引入的模块
      //对ast解析遍历语法树，负责替换，删除和添加节点
      ImportDeclaration({ node }) {
        const dirname = path.dirname(file);
        const abspath = "./" + path.join(dirname, node.source.value);
        dependencies[node.source.value] = abspath; //基于import获取文件需要的依赖
      },
    });
    //console.log(dependencies);
    //es6转es5
    const { code } = babel.transformFromAst(ast, null, {
      presets: ["@babel/preset-env"],
    });
    //console.log(code);
    const moduleInfo = { file, code, dependencies };
    return moduleInfo;
  }
```

#### 构建模块

1.先传入主模块路径和内容，获得模块信息放到 temp 数组

2.循环里面获得主模块的依赖 deps

3.遍历主模块的依赖 deps，调用 parse 获得依赖模块信息，继续放到 temps 数组中
实际就是将层层依赖进行收集打平

```js
buildModule(modulePath) {
    const source = this.getSourceByPath(modulePath); //根据路径拿到源码
    const entry = this.parse(source, modulePath);
    //console.log(entry);
    const temp = [entry];
    for (let i = 0; i < temp.length; i++) {
      const deps = temp[i].dependencies;
      if (deps) {
        for (const key in deps) {
          if (deps.hasOwnProperty(key)) {
            let content = this.getSourceByPath(deps[key]);
            temp.push(this.parse(content, deps[key]));
          }
        }
      }
    }
    temp.forEach((moduleInfo) => {
      this.depsGraph[moduleInfo.file] = {
        deps: moduleInfo.dependencies,
        code: moduleInfo.code,
      };
    });
    this.depsGraph = JSON.stringify(this.depsGraph);
  }
```

此时生成的 depsGraph:

```
{
  file: './src/index.js',
  code: '"use strict";\n' +
    '\n' +
    'var _add = _interopRequireDefault(require("./add.js"));\n' +
    'var _minus = require("./minus.js");\n' +
    'function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }\n' +
    'var sum = (0, _add["default"])(1, 2);\n' +
    'var division = (0, _minus.minus)(2, 1);\n' +
    'console.log(sum);\n' +
    'console.log(division);',
  dependencies: { './add.js': './src\\add.js', './minus.js': './src\\minus.js' }
}
```

但是还不能执行 code 中 index.js 这段代码，因为浏览器不会识别 require 和 exports,因为没有定义这些 require 和 exports 对象，因此要自己定义，将主模块路径传入 bundler 中，将保存的 depsGraph 传入一个立即执行函数，执行 require 的时候又立即执行一个立即执行函数，把 code 值传入执行 eval(code),但是执行这段代码的时候，又会用到 require 函数，此时 require 的参数是 add.js 的路径，var \_add = \_interopRequireDefault(require("./add.js"))不是绝对路径，因此要写一个**absRequire**函数来转化，

```js
bundler(file) {
    return `
     (function (graph) {
      function require(file) {
        function absRequire(relPath) {
          return require(graph[file].deps[relPath]);
        }
        var exports = {};
        (function (require, exports, code) {
          eval(code);
        })(absRequire, exports, graph[file]?.code);
        return exports;
      }
      require('${file}');
    })(${this.depsGraph});`;
  }

```

实际上执行 require('./src/index.js')后，执行

```js
(function (require, code) {
  eval(code);
})(absRequire, graph[file].code);
```

执行 eval,也就执行 index.js 的代码，但是又会调用 require 函数，也就是我们传递的 absRequire,而执行 absRequire 就执行 rreturn require(graph[file].deps[relPath]),将执行外面这个 require,继续周而复始执行立即执行函数，调用 require,路径已经转化为绝对路径，成功执行相应的 eval(code)
但是在执行 add.js 的 code，会遇到 exports 还没定义的问题，

```js
// add.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports["default"] = void 0;
var _default = function _default(a, b) {
  return a + b;
};
exports["default"] = _default;
```

定义一个 exports 使用，执行 add.js 代码时会在这个空对象上增加属性并返回
outPutFile():

```js
//输出文件
  outputFile() {
    const code = this.bundler(this.entryPath);
    //拿到输出地址
    let outPath = path.join(
      this.config.output.path,
      this.config.output.filename
    );
    console.log(code);
    fs.writeFileSync(outPath, code); //写入
  }
```
