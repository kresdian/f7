/* eslint import/no-extraneous-dependencies: ["error", {"devDependencies": true}] */
/* eslint no-console: "off" */
/* eslint global-require: "off" */
/* eslint no-param-reassign: ["error", { "props": false }] */
/* eslint arrow-body-style: "off" */
const fs = require('fs');
const rollup = require('rollup');
const buble = require('rollup-plugin-buble');
const resolve = require('rollup-plugin-node-resolve');
const commonjs = require('rollup-plugin-commonjs');
const replace = require('rollup-plugin-replace');
const modifyFile = require('gulp-modify-file');
const gulp = require('gulp');
const less = require('gulp-less');
const autoprefixer = require('gulp-autoprefixer');
const cleanCSS = require('gulp-clean-css');
const uglify = require('gulp-uglify');
const rename = require('gulp-rename');
const getConfig = require('./get-core-config.js');
const getOutput = require('./get-output.js');

const coreComponents = [
  'app',
  'statusbar',
  'view',
  'navbar',
  'toolbar',
  'subnavbar',
  'touch-ripple',
  'modal',
  'page',
  'link',
  'block',
  'list',
  'badge',
  'button',
  'icon',
];

const intro = `
function framework7ComponentLoader(Framework7, Framework7AutoInstallComponent) {
  if (typeof Framework7AutoInstallComponent === 'undefined') {
    Framework7AutoInstallComponent = true;
  }
  var doc = document;
  var win = window;
  var $ = Framework7.$;
  var Template7 = Framework7.Template7;
  var Utils = Framework7.utils;
  var Device = Framework7.device;
  var Support = Framework7.support;
  var Framework7Class = Framework7.Class;
  var Modal = Framework7.Modal;
  var ConstructorMethods = Framework7.ConstructorMethods;
  var ModalMethods = Framework7.ModalMethods;

  `;

const install = `
  if (Framework7AutoInstallComponent) {
    if (Framework7.prototype.modules && Framework7.prototype.modules[COMPONENT.name]) {
      return;
    }
    Framework7.use(COMPONENT);
    if (Framework7.instance) {
      Framework7.instance.useModuleParams(COMPONENT, Framework7.instance.params);
      Framework7.instance.useModule(COMPONENT);
    }
  }
  return COMPONENT;
`;

const outro = `
};
`;

function buildLazyComponentsLess(rtl, components, cb) {
  // const env = process.env.NODE_ENV || 'development';
  const config = getConfig();
  const output = `${getOutput()}/core`;
  const colors = `{\n${Object.keys(config.colors).map(colorName => `  ${colorName}: ${config.colors[colorName]};`).join('\n')}\n}`;
  const includeIosTheme = config.themes.indexOf('ios') >= 0;
  const includeMdTheme = config.themes.indexOf('md') >= 0;
  const includeDarkTheme = config.darkTheme;

  const main = fs.readFileSync('./src/core/framework7.less', 'utf8')
    .split('\n')
    .filter(line => line.indexOf('@import url(\'./components') < 0)
    .join('\n')
    .replace('@import (reference) \'./less/mixins.less\';', '@import (reference) \'../../less/mixins.less\';')
    .replace('$includeIosTheme', includeIosTheme)
    .replace('$includeMdTheme', includeMdTheme)
    .replace('$includeDarkTheme', includeDarkTheme)
    .replace('$themeColor', config.themeColor)
    .replace('$colors', colors)
    .replace('$rtl', rtl);

  let cbs = 0;
  const componentsToProcess = components.filter((component) => { // eslint-disable-line
    return fs.existsSync(`./src/core/components/${component}/${component}.less`) && coreComponents.indexOf(component) < 0;
  });

  componentsToProcess.forEach((component) => {
    gulp
      .src(`./src/core/components/${component}/${component}.less`)
      .pipe(modifyFile(content => `${main}\n${content}`))
      .pipe(less())
      .pipe(autoprefixer({
        cascade: false,
      }))
      .pipe(cleanCSS({
        compatibility: '*,-properties.zeroUnits',
      }))
      .pipe(rename((filePath) => {
        if (rtl) filePath.basename += '.rtl';
      }))
      .pipe(gulp.dest(`${output}/components/`))
      .on('end', () => {
        cbs += 1;
        if (cbs === componentsToProcess.length && cb) cb();
      });
  });
}

function buildLazyComponentsJs(components, cb) {
  const config = getConfig();
  const env = process.env.NODE_ENV || 'development';
  const target = process.env.TARGET || config.target || 'universal';
  const format = 'umd';
  const output = `${getOutput()}/core`;

  const componentsToProcess = components.filter((component) => { // eslint-disable-line
    return fs.existsSync(`./src/core/components/${component}/${component}.js`);
  });

  rollup
    .rollup({
      input: componentsToProcess.map(component => `./src/core/components/${component}/${component}.js`),
      experimentalOptimizeChunks: true,
      plugins: [
        replace({
          delimiters: ['', ''],
          'process.env.NODE_ENV': JSON.stringify(env), // or 'production'
          'process.env.TARGET': JSON.stringify(target),
          'process.env.FORMAT': JSON.stringify(format),
        }),
        resolve({ jsnext: true }),
        commonjs(),
        buble(),
      ],
      onwarn(warning, warn) {
        const ignore = ['EVAL'];
        if (warning.code && ignore.indexOf(warning.code) >= 0) {
          return;
        }
        warn(warning);
      },
    })
    .then((bundle) => { // eslint-disable-line
      return bundle.write({
        strict: true,
        dir: `${output}/components/`,
        format: 'es',
        exports: 'default',
      });
    })
    .then(() => {
      const files = fs.readdirSync(`${output}/components/`);
      const filesToProcess = files.filter((fileName) => { // eslint-disable-line
        return fileName.indexOf('.js') > 0
          && fileName.indexOf('chunk-') < 0
          && coreComponents.indexOf(fileName.split('.js')[0]) < 0;
      });
      const filesToRemove = files.filter((fileName) => { // eslint-disable-line
        return fileName.indexOf('.js') > 0
          && (
            fileName.indexOf('chunk-') === 0
            || coreComponents.indexOf(fileName.split('.js')[0]) >= 0
          );
      });
      let cbs = 0;
      filesToProcess.forEach((fileName) => {
        let fileContent = fs.readFileSync(`${output}/components/${fileName}`, 'utf8')
          .split('\n')
          .filter(line => line.indexOf('import ') !== 0)
          .map(line => line.trim().length ? `  ${line}` : line) // eslint-disable-line
          .join('\n');

        fileContent = `${intro}${fileContent.trim()}${outro}`;
        fileContent = fileContent
          .replace(/export default ([a-zA-Z_]*);/, (line, name) => { // eslint-disable-line
            return install.replace(/COMPONENT/g, name);
          });

        fs.writeFileSync(`${output}/components/${fileName}`, `${fileContent}\n`);

        gulp.src(`${output}/components/${fileName}`)
          .pipe(uglify())
          .pipe(modifyFile((content) => { // eslint-disable-line
            return `(${content}(Framework7, typeof Framework7AutoInstallComponent === 'undefined' ? undefined : Framework7AutoInstallComponent))`;
          }))
          .pipe(gulp.dest(`${output}/components/`))
          .on('end', () => {
            cbs += 1;
            if (cbs === filesToProcess.length && cb) cb();
          });
      });

      filesToRemove.forEach((fileName) => {
        fs.unlinkSync(`${output}/components/${fileName}`);
      });
    })
    .catch((err) => {
      console.log(err.toString());
    });
}

function buildLazyComponents(cb) {
  let cbs = 0;
  const env = process.env.NODE_ENV || 'development';
  const targetCbs = env === 'development' ? 2 : 3;
  const config = getConfig();
  const components = fs.readdirSync('./src/core/components').filter(c => c.indexOf('.') < 0);
  function callback() {
    cbs += 1;
    if (cbs === targetCbs && cb) cb();
  }
  buildLazyComponentsJs(components, callback);
  if (env === 'production') {
    buildLazyComponentsLess(false, components, callback);
    buildLazyComponentsLess(true, components, callback);
  } else {
    buildLazyComponentsLess(config.rtl, components, callback);
  }
}

module.exports = buildLazyComponents;