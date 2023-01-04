class MyPlugin {
  apply(compiler) {
    compiler.hooks.run.tap("myPlugin", (compilation) => {
      console.log("my plugin");
    });
  }
}
module.exports = MyPlugin;
