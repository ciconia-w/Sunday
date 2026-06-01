#!/bin/bash
# 随便写个读bash的小脚本

echo "你叫啥？"
read name
echo "你好, $name!"

echo ""
echo "想读哪个文件？（输入路径，没有就跳过）"
read filepath

if [[ -f "$filepath" ]]; then
    echo "--- $filepath 的前5行 ---"
    head -5 "$filepath"
else
    echo "文件不存在，算了~"
fi

echo ""
echo "当前目录文件一览："
ls -lh --color=auto
