const path = require("path");
const fs = require("fs");
/*babylon将源码转成ast Babylon 是Babel中使用的JavaSript解析器
@babel/traverse 对ast解析遍历语法树
@babel/types用于AST结点的lodash-esque实用程序库
@babel/generator结果生成 */
//const babylon = require("babylon");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const type = require("@babel/types");
const babel = require("@babel/core");
const tapable = require("tapable");
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
  }
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

  //构建模块
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
    console.log(this.depsGraph);
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
}
module.exports = WebpackCompiler;
