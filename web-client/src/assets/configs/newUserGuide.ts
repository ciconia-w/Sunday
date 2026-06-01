import type { NewUserGuidePage } from "@/components/NewUserGuideDialog";
import guideEn01Dark from "@/assets/images/guide_en_01_dark.png";
import guideEn01Light from "@/assets/images/guide_en_01_light.png";
import guideEn02Dark from "@/assets/images/guide_en_02_dark.png";
import guideEn02Light from "@/assets/images/guide_en_02_light.png";
import guideEn03Dark from "@/assets/images/guide_en_03_dark.png";
import guideEn03Light from "@/assets/images/guide_en_03_light.png";
import guideEn04Dark from "@/assets/images/guide_en_04_dark.png";
import guideEn04Light from "@/assets/images/guide_en_04_light.png";
import guideEn05Dark from "@/assets/images/guide_en_05_dark.png";
import guideEn05Light from "@/assets/images/guide_en_05_light.png";
import guideZh01Dark from "@/assets/images/guide_zh_01_dark.png";
import guideZh01Light from "@/assets/images/guide_zh_01_light.png";
import guideZh02Dark from "@/assets/images/guide_zh_02_dark.png";
import guideZh02Light from "@/assets/images/guide_zh_02_light.png";
import guideZh03Dark from "@/assets/images/guide_zh_03_dark.png";
import guideZh03Light from "@/assets/images/guide_zh_03_light.png";
import guideZh04Dark from "@/assets/images/guide_zh_04_dark.png";
import guideZh04Light from "@/assets/images/guide_zh_04_light.png";
import guideZh05Dark from "@/assets/images/guide_zh_05_dark.png";
import guideZh05Light from "@/assets/images/guide_zh_05_light.png";

type Translate = (key: string) => string;
type GuideLocale = "en" | "zh";

interface NewUserGuideImageConfig {
    light: string;
    dark: string;
}

interface NewUserGuidePageConfig {
    image: Record<GuideLocale, NewUserGuideImageConfig>;
    titleKey: string;
    descriptionKeys: string[];
}

const createGuideImageConfig = (
    enLight: string,
    enDark: string,
    zhLight: string,
    zhDark: string,
): Record<GuideLocale, NewUserGuideImageConfig> => ({
    en: {
        light: enLight,
        dark: enDark,
    },
    zh: {
        light: zhLight,
        dark: zhDark,
    },
});

// Keep copy as translation keys so it resolves after backend.loadTranslations() completes.
const NEW_USER_GUIDE_PAGE_CONFIGS: NewUserGuidePageConfig[] = [
    {
        image: createGuideImageConfig(guideEn01Light, guideEn01Dark, guideZh01Light, guideZh01Dark),
        titleKey: "Sunday Desktop Shell",
        descriptionKeys: [
            "A focused desktop client for one general-purpose agent",
            "Clear navigation for chat, model settings, history, and local file work",
            "A wider workspace for tool output, files, and long replies",
            "A simpler shell that is easier to extend later",
        ],
    },
    {
        image: createGuideImageConfig(guideEn02Light, guideEn02Dark, guideZh02Light, guideZh02Dark),
        titleKey: "One agent, one focused desktop workflow",
        descriptionKeys: [
            "Start a clean chat without switching between product modes",
            "Keep conversation, tool output, and files in one workspace",
            "Follow live progress directly from the desktop shell",
        ],
    },
    {
        image: createGuideImageConfig(guideEn03Light, guideEn03Dark, guideZh03Light, guideZh03Dark),
        titleKey: "Work with local files and grounded tool output",
        descriptionKeys: [
            "Attach local files and inspect the result in the same session",
            "Use shell and file tools without leaving the chat flow",
            "Keep model configuration and local credentials under your control",
            "Build later extensions on top of the same desktop host",
        ],
    },
    {
        image: createGuideImageConfig(guideEn04Light, guideEn04Dark, guideZh04Light, guideZh04Dark),
        titleKey: "Tools and extensions in one desktop shell",
        descriptionKeys: [
            "Inspect real tool calls directly in the chat flow",
            "Use file operations and bash from the same agent session",
            "Add Skills and MCP services as later extension surfaces",
        ],
    },
    {
        image: createGuideImageConfig(guideEn05Light, guideEn05Dark, guideZh05Light, guideZh05Dark),
        titleKey: "History stays searchable and easy to clean up",
        descriptionKeys: [
            "Search recent conversations without leaving the desktop shell",
            "Review previous tool runs and file work from the same history list",
            "Batch cleanup keeps the workspace focused as you iterate",
        ],
    },
];

const getGuideLocale = (isChineseLanguage: boolean): GuideLocale => (isChineseLanguage ? "zh" : "en");

const getGuideImage = (
    imageConfig: Record<GuideLocale, NewUserGuideImageConfig>,
    isDarkMode: boolean,
    isChineseLanguage: boolean,
) => {
    const locale = getGuideLocale(isChineseLanguage);
    const variant = imageConfig[locale];
    return isDarkMode ? variant.dark : variant.light;
};

export const getNewUserGuidePages = (
    translate: Translate,
    isDarkMode: boolean,
    isChineseLanguage: boolean,
): NewUserGuidePage[] => {
    return NEW_USER_GUIDE_PAGE_CONFIGS.map((page) => ({
        image: getGuideImage(page.image, isDarkMode, isChineseLanguage),
        title: translate(page.titleKey),
        description: page.descriptionKeys.map((descriptionKey) => translate(descriptionKey)),
    }));
};
