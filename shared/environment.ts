import { processSpecs } from './model.js';
import { displayNumber } from './parameter-presentation.js';
export const parameterSpecs = {
  rain: { label: '降雨强度', min: 0, max: 2, step: .1, default: 1, group: '气候与植被', hint: '补充土壤与水体。零降雨后储水逐步下降，植物会延迟减产。' },
  temperature: { label: '环境温度', min: -10, max: 45, step: 1, default: 20, group: '气候与植被', hint: '基础温度叠加昼夜和季节变化；顶部显示实际温度，严寒与酷热增加消耗。' },
  sunlight: { label: '日照强度', min: 0, max: 2, step: .1, default: 1, group: '气候与植被', hint: '影响光合作用；完全黑暗会停止植物生长。' },
  fertility: { label: '土壤肥力', min: 0, max: 2, step: .1, default: 1, group: '气候与植被', hint: '增加单位时间的植物恢复量，但无法替代水与日照。' },
  plantNutrition: { label: '植物营养', min: .3, max: 2, step: .1, default: 1, group: '生存与资源', hint: '同样的植被能为食草动物提供多少能量。' },
  metabolism: { label: '基础代谢', min: .5, max: 2, step: .1, default: 1, group: '生存与资源', hint: '越高越容易饥饿，捕食压力会随之增大。' },
  lifespan: { label: '自然寿命', min: .5, max: 2, step: .1, default: 1, group: '生存与资源', hint: '调整两类动物的寿命上限，影响代际更替速度。' },
  grazerBirthRate: { label: '兔群繁殖率', min: 0, max: 2.5, step: .1, default: 1, group: '物种与演化', hint: '调整符合条件雌兔的受孕概率；孕期由妊娠时长设定，零值禁止新受孕。' },
  hunterBirthRate: { label: '狐群繁殖率', min: 0, max: 2.5, step: .1, default: 1, group: '物种与演化', hint: '调整符合条件雌狐的受孕概率；成熟、配对、能量和季节共同限制。' },
  grazerSpeed: { label: '兔群移动速度', min: .5, max: 1.8, step: .1, default: 1, group: '物种与演化', hint: '影响觅食与逃逸速度，仍受个体基因与体力限制。' },
  hunterSpeed: { label: '狐群移动速度', min: .5, max: 1.8, step: .1, default: 1, group: '物种与演化', hint: '改变追猎效率，过强的捕食能力可能导致猎物崩溃。' },
  vision: { label: '感知范围', min: .5, max: 1.5, step: .1, default: 1, group: '物种与演化', hint: '扩大动物发现猎物、威胁和植物的范围。' },
  mutation: { label: '基因变异', min: 0, max: 3, step: .1, default: 1, group: '物种与演化', hint: '后代继承双亲基因均值并发生变异；零值关闭随机变异。' },
} as const;
export type QuickParameterKey = keyof typeof parameterSpecs;
export const allParameterSpecs = { ...parameterSpecs, ...processSpecs };
export type EnvironmentKey = keyof typeof allParameterSpecs;
export type Environment = Record<EnvironmentKey, number>;
export const environmentDefaults = Object.fromEntries(Object.entries(allParameterSpecs).map(([key, s]) => [key, s.default])) as Environment;
export const environmentPresets: Record<string, { label: string; description: string; values: Environment }> = {
  balanced: { label: '温和原野', description: '水热适宜，观察自然演化。', values: { ...environmentDefaults } },
  wet: { label: '丰水繁盛', description: '高产植被与快速繁殖，观察种群扩张。', values: { ...environmentDefaults, rain: 1.7, fertility: 1.4, sunlight: 1.3, grazerBirthRate: 1.6 } },
  dry: { label: '旱季求生', description: '高温、缺水和低营养，食物链承压。', values: { ...environmentDefaults, rain: .2, temperature: 36, fertility: .7, plantNutrition: .7, metabolism: 1.2 } },
  winter: { label: '凛冬试炼', description: '寒冷与短日照，寻找越冬的平衡。', values: { ...environmentDefaults, temperature: -5, sunlight: .4, rain: .5, metabolism: 1.3, grazerBirthRate: .4, hunterBirthRate: .5 } },
  armsRace: { label: '捕食竞赛', description: '更快、更敏锐的狐狸，对抗高变异兔群。', values: { ...environmentDefaults, hunterSpeed: 1.5, grazerSpeed: 1.2, vision: 1.5, mutation: 2.5, grazerBirthRate: 1.6 } },
};
export function preciseNumber(value: number) { return String(Number(value.toPrecision(15))); }
export function formatParameter(key: EnvironmentKey, value: number) { return key in processSpecs ? `${displayNumber(value)} ${processSpecs[key as keyof typeof processSpecs].unit}` : key === 'temperature' ? `${displayNumber(value)}°C` : `${displayNumber(value * 100)}%`; }
