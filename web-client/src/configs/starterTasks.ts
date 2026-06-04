export interface StarterTask {
    id: string;
    icon: string;
    title: string;
    description: string;
    prompt: string;
}

export const STARTER_TASKS: StarterTask[] = [
    {
        id: "repo",
        icon: "📁",
        title: "检查工作区",
        description: "先梳理项目结构和关键文件",
        prompt: "请先检查当前工作区，概括项目结构，并列出最值得先看的文件和原因。",
    },
    {
        id: "file",
        icon: "📄",
        title: "处理文件",
        description: "先看文档和源码里有哪些待处理点",
        prompt: "请先扫描当前工作区里的文档和源码文件，说明有哪些文件最值得继续处理或修改。",
    },
    {
        id: "bash",
        icon: "⚡",
        title: "运行 Bash",
        description: "先检查环境和仓库当前状态",
        prompt: "请先检查当前环境和仓库状态，运行必要的 bash 命令，并汇总关键结果。",
    },
];
