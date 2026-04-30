#!/bin/bash
#
# @file build.sh
# @description B站直播插件一键编译打包脚本
#
# 主要功能：
# - 自动检测 Node.js 环境
# - 安装项目依赖（跳过 devDependencies 中的多余安装）
# - TypeScript 类型检查
# - ESLint 代码规范检查
# - Webpack 生产模式编译
# - 使用 @vscode/vsce 打包为 .vsix 文件
# - 输出打包结果摘要
#
# 在项目中的角色：
# 为开发者提供一键式构建流程，确保插件在不同环境下均可稳定编译和打包
#
# @author zls3434
# @date 2026-04-30
# @modification 2026-04-30 zls3434 创建一键编译打包脚本

set -euo pipefail

# ==================== 颜色输出定义 ====================
# 用于终端友好的彩色日志输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ==================== 全局变量 ====================
# 项目根目录（脚本所在目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 扩展名称，从 package.json 中动态读取
EXT_NAME=$(node -p "require('./package.json').name" 2>/dev/null || echo "bili-live-ext")
EXT_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.1")
VSIX_FILE="${EXT_NAME}-${EXT_VERSION}.vsix"

# 是否跳过 lint（默认不跳过，传 --skip-lint 跳过）
SKIP_LINT=false
# 是否跳过类型检查
SKIP_TYPECHECK=false
# 是否为安静模式（减少输出）
QUIET_MODE=false

# ==================== 辅助函数 ====================

#
# 输出带颜色的日志信息
#
log_info() { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

#
# 输出分隔线
#
print_separator() {
    echo -e "${BLUE}================================================${NC}"
}

#
# 显示脚本用法
#
show_usage() {
    cat << EOF
用法: ./build.sh [选项]

选项:
  --skip-lint       跳过 ESLint 代码检查步骤
  --skip-typecheck  跳过 TypeScript 类型检查步骤
  --quiet           安静模式，减少输出
  -h, --help        显示此帮助信息

示例:
  ./build.sh                    # 完整编译打包流程
  ./build.sh --skip-lint        # 跳过 lint 步骤
  ./build.sh --skip-typecheck   # 跳过类型检查步骤
EOF
}

# ==================== 参数解析 ====================
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-lint)
            SKIP_LINT=true
            shift
            ;;
        --skip-typecheck)
            SKIP_TYPECHECK=true
            shift
            ;;
        --quiet)
            QUIET_MODE=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            log_error "未知选项: $1"
            show_usage
            exit 1
            ;;
    esac
done

# ==================== 环境检查 ====================

print_separator
log_info "🚀 B站直播插件一键编译打包脚本"
log_info "   项目: ${EXT_NAME} v${EXT_VERSION}"
print_separator

# 步骤1: 检查 Node.js 环境
# VSCode 扩展开发要求 Node.js >= 18
log_info "检查 Node.js 环境..."
if ! command -v node &> /dev/null; then
    log_error "未找到 Node.js，请安装 Node.js (>= 18) 后再执行此脚本"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    log_warn "Node.js 版本为 $(node -v)，建议升级到 >= 18"
fi
log_success "Node.js 版本: $(node -v)"

# 检查 npm 是否可用
if ! command -v npm &> /dev/null; then
    log_error "未找到 npm，请安装 npm 后再执行此脚本"
    exit 1
fi
log_success "npm 版本: $(npm -v)"

# ==================== 依赖安装 ====================

print_separator
log_info "📦 安装项目依赖..."

# 检查 node_modules 是否存在以及 package-lock.json 是否变化
NEED_INSTALL=false
if [ ! -d "node_modules" ]; then
    NEED_INSTALL=true
    log_info "node_modules 目录不存在，需要安装依赖"
elif [ "package.json" -nt "node_modules" ] || [ "package-lock.json" -nt "node_modules" ]; then
    NEED_INSTALL=true
    log_info "package.json 或 package-lock.json 已更新，需要重新安装依赖"
fi

if [ "$NEED_INSTALL" = true ]; then
    if [ "$QUIET_MODE" = true ]; then
        npm install --loglevel=error
    else
        npm install
    fi
    if [ $? -ne 0 ]; then
        log_error "依赖安装失败"
        exit 1
    fi
else
    log_success "依赖已是最新，跳过安装"
fi

# ==================== 清理构建产物 ====================

print_separator
log_info "🧹 清理旧的构建产物..."

# 清理 dist 目录（webpack 输出目录）
if [ -d "dist" ]; then
    rm -rf dist
    log_info "已清理 dist 目录"
fi

# 清理旧的 .vsix 文件
if ls *.vsix 1> /dev/null 2>&1; then
    rm -f *.vsix
    log_info "已清理旧 .vsix 文件"
fi

log_success "清理完成"

# ==================== TypeScript 类型检查 ====================

if [ "$SKIP_TYPECHECK" = false ]; then
    print_separator
    log_info "🔍 TypeScript 类型检查..."

    npx tsc --noEmit
    if [ $? -ne 0 ]; then
        log_error "TypeScript 类型检查失败，请修复类型错误后重试"
        exit 1
    fi
    log_success "TypeScript 类型检查通过"
else
    log_warn "已跳过 TypeScript 类型检查"
fi

# ==================== ESLint 代码检查 ====================

if [ "$SKIP_LINT" = false ]; then
    print_separator
    log_info "📝 ESLint 代码规范检查..."

    npm run lint
    if [ $? -ne 0 ]; then
        log_warn "ESLint 检查发现警告或错误（不中断打包流程）"
    else
        log_success "ESLint 检查通过"
    fi
else
    log_warn "已跳过 ESLint 代码检查"
fi

# ==================== Webpack 编译 ====================

print_separator
log_info "🔨 Webpack 生产环境编译..."

npm run package
if [ $? -ne 0 ]; then
    log_error "Webpack 编译失败"
    exit 1
fi

# 检查编译产物是否存在
if [ ! -f "dist/extension.js" ]; then
    log_error "编译产物 dist/extension.js 不存在，编译可能未成功"
    exit 1
fi

log_success "Webpack 编译完成"

# ==================== 打包 .vsix ====================

print_separator
log_info "📦 打包 .vsix 文件..."

# 使用 @vscode/vsce 工具打包
# --no-dependencies 避免检查 dependencies 版本问题
npx vsce package --no-dependencies

if [ $? -ne 0 ]; then
    log_error "打包 .vsix 文件失败"
    exit 1
fi

# ==================== 输出结果 ====================

print_separator

# 验证 .vsix 文件是否成功生成
if [ -f "$VSIX_FILE" ]; then
    VSIX_SIZE=$(du -h "$VSIX_FILE" | cut -f1)
    log_success "✅ 打包成功！"
    echo ""
    echo -e "  ${GREEN}文件名称:${NC} ${VSIX_FILE}"
    echo -e "  ${GREEN}文件大小:${NC} ${VSIX_SIZE}"
    echo -e "  ${GREEN}文件路径:${NC} ${SCRIPT_DIR}/${VSIX_FILE}"
    echo ""
    echo -e "  ${YELLOW}安装方式:${NC}"
    echo -e "    1. VSCode 中按 Ctrl+Shift+P，输入 \"Extensions: Install from VSIX\""
    echo -e "    2. 选择生成的 ${VSIX_FILE} 文件即可安装"
    echo -e "    3. 或使用命令行: code --install-extension ${VSIX_FILE}"
    echo ""
else
    # 如果文件名不匹配（如 package.json 中的 name/v 与预期不同），查找实际生成的 .vsix
    ACTUAL_VSIX=$(ls -t *.vsix 2>/dev/null | head -1)
    if [ -n "$ACTUAL_VSIX" ]; then
        VSIX_SIZE=$(du -h "$ACTUAL_VSIX" | cut -f1)
        log_success "✅ 打包成功！"
        echo ""
        echo -e "  ${GREEN}文件名称:${NC} ${ACTUAL_VSIX}"
        echo -e "  ${GREEN}文件大小:${NC} ${VSIX_SIZE}"
        echo -e "  ${GREEN}文件路径:${NC} ${SCRIPT_DIR}/${ACTUAL_VSIX}"
        echo ""
        echo -e "  ${YELLOW}安装方式:${NC}"
        echo -e "    code --install-extension ${ACTUAL_VSIX}"
        echo ""
    else
        log_error "打包文件未找到，请检查 @vscode/vsce 配置"
        exit 1
    fi
fi

print_separator
log_success "🎉 一键编译打包流程全部完成！"
exit 0
