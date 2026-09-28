const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// Always resolve these from the mobile app, so only one copy is bundled
const SINGLETONS = ['react', 'react-dom', 'react-native'];

const defaultResolve = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isSingleton = SINGLETONS.some(
    (name) => moduleName === name || moduleName.startsWith(name + '/')
  );

  if (isSingleton) {
    return context.resolveRequest(
      { ...context, originModulePath: path.join(projectRoot, 'index.js') },
      moduleName,
      platform
    );
  }

  return defaultResolve
    ? defaultResolve(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;