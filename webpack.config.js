/**
 * @file webpack.config.js
 * @description VSCode 扩展 Webpack 构建配置
 *
 * 主要功能：
 * - 将 TypeScript 源码编译为单个 CommonJS 模块
 * - 排除 vscode 内置模块，由运行时提供
 * - 支持开发模式(source-map)和生产模式(hidden-source-map)
 *
 * @author zls3434
 * @date 2026-04-30
 * @modification 2026-04-30 zls3434 创建 Webpack 构建配置，用于打包 VSCode 扩展
 */

'use strict';

const path = require('path');

/**
 * Webpack 配置对象
 * target: node - 目标环境为 Node.js（VSCode 扩展运行环境）
 * externals: vscode - 排除 vscode 模块，因为扩展宿主环境已提供该模块
 */
const config = {
  /** @type {'node'} 构建目标为 Node.js 环境 */
  target: 'node',

  /** @type {'production' | 'development' | 'none'} 构建模式，由 CLI 参数 --mode 指定 */
  mode: 'none',

  /** 入口文件：扩展的主入口 TypeScript 文件 */
  entry: './src/extension.ts',

  /** 输出配置 */
  output: {
    /** 输出目录 */
    path: path.resolve(__dirname, 'dist'),
    /** 输出文件名 */
    filename: 'extension.js',
    /** 模块格式：CommonJS，VSCode 扩展使用该格式加载 */
    libraryTarget: 'commonjs2',
  },

  /** 外部依赖：vscode 模块由 VSCode 扩展宿主在运行时提供；
   *  bufferutil/utf-8-validate 为 ws 的可选原生性能模块，无需打包 */
  externals: {
    vscode: 'commonjs vscode',
    bufferutil: 'commonjs bufferutil',
    'utf-8-validate': 'commonjs utf-8-validate',
  },

  /** 模块解析配置 */
  resolve: {
    /** 支持解析的文件扩展名 */
    extensions: ['.ts', '.js'],
  },

  /** 模块处理规则 */
  module: {
    rules: [
      {
        /** 匹配所有 .ts 文件 */
        test: /\.ts$/,
        /** 排除 node_modules 目录 */
        exclude: /node_modules/,
        /** 使用 ts-loader 编译 TypeScript */
        use: [
          {
            loader: 'ts-loader',
          },
        ],
      },
    ],
  },

  /** Source Map 配置：由 --devtool 参数控制 */
  devtool: 'nosources-source-map',

  /** 基础设施日志级别 */
  infrastructureLogging: {
    level: 'log',
  },
};

module.exports = config;
