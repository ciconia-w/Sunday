import { defineComponent } from "vue";

export default defineComponent({
    name: "WindowTitleBar",
    setup() {
        let sx = 0, sy = 0;
        const md = (e: MouseEvent) => {
            if (e.button !== 0) return;
            sx = e.clientX; sy = e.clientY;
            document.addEventListener("mousemove", mm); document.addEventListener("mouseup", mu);
            e.preventDefault(); e.stopPropagation();
        };
        const mm = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
        const mu = () => { document.removeEventListener("mousemove", mm); document.removeEventListener("mouseup", mu); };
        return { md };
    },
    render() {
        return <div class="title-bar" onMousedown={this.md} />;
    },
});
