import type { Parameters, Species } from './types.js';

function coefficient(label: string, unit: string, value: number, min: number, max: number, step: number, group: string, hint: string, mechanism: string) {
  return { label, unit, default: value, min, max, step, group, hint, mechanism };
}
/** Simulation-unit coefficients, not measurements fitted to real rabbits or foxes. */
export const processSpecs = {
  seasonStrength: coefficient('季节振幅', '倍', 1, 0, 2, .1, '气候强迫', '缩放季节温差、雨量和繁殖季节性；0取消这些修正，季节光周期仍变化。', '雨量/繁殖修正 = max(0, 1 + 振幅 × (季节系数 − 1))；温差 = 偏移 × 振幅'),
  diurnalAmplitude: coefficient('昼夜温差振幅', '°C', 3, 0, 10, .5, '气候强迫', '日内温度围绕季节基准上下波动，峰谷温差为振幅的两倍。', 'T = 基温 + 季节偏移 + 振幅 × cos(时相)'),
  rainInfiltration: coefficient('降雨入渗率', '水分点/s', .15, 0, .6, .01, '水文与土壤', '单位实际降雨倍率对土壤水分指数的补充速率；不是 mm/s。', '入渗 = 实际降雨倍率 × 入渗率'),
  evaporationBase: coefficient('基础蒸发率', '水分点/s', .04, 0, .2, .005, '水文与土壤', '暗处和低温下仍存在的基础水分损失。', '蒸发 = 基础项 + 热蒸发项'),
  evaporationHeat: coefficient('热蒸发系数', '点/(s·°C)', .003, 0, .015, .001, '水文与土壤', '正温度与光照共同增强蒸发；光照因子最低取 0.1。', '热蒸发 = 系数 × max(T,0) × max(光照,0.1)'),
  waterRecharge: coefficient('水体补给率', '水位点/s', .24, 0, 1, .02, '水文与土壤', '河湖在降雨下的补给项，另有固定微量基流；水位低于10不能饮用。', '水位变化 = 降雨 × 补给率 + 0.025 − 蒸发'),
  soilExchange: coefficient('岸边土壤补水', '水分点/s', .035, 0, .2, .005, '水文与土壤', '同一8×8土壤单元内水位大于20时增加补水。', '水位 > 20 时补水，否则为 0'),
  growthRate: coefficient('潜在植物生产率', 'VU/(格·s)', .65, 0, 2, .05, '初级生产', '充足水、肥、光和适温下的最大基准增长；VU 为相对植被单位。', '增长 = 速率 × 肥力 × 光照 × fT × fW × fN'),
  growthOptimum: coefficient('植物最适温度', '°C', 20, 0, 35, 1, '初级生产', '三角形温度响应的峰值位置。', 'fT = max(0, 1 − |T − Topt| / 温度耐受宽度)'),
  thermalWidth: coefficient('温度耐受宽度', '°C', 30, 5, 50, 1, '初级生产', '距最适温度达到该值时，植物增长和热适宜度归零。', '生长温区 = Topt ± 宽度'),
  moistureThreshold: coefficient('水分饱和阈值', '水分点', 45, 5, 100, 1, '初级生产', '水分达到此值时水分限制解除；不是半饱和常数。', 'fW = min(1, 土壤水分 / 阈值)'),
  nutrientThreshold: coefficient('养分饱和阈值', '养分点', 40, 5, 100, 1, '初级生产', '养分达到此值时养分限制解除。', 'fN = min(1, 土壤养分 / 阈值)'),
  moistureCost: coefficient('生长耗水系数', '水分点/VU', .003, .001, .02, .001, '初级生产', '土壤单元内每新增一个植被单位扣减的水分。', '水分消耗 = 实际新增 VU × 系数'),
  nutrientCost: coefficient('生长耗肥系数', '养分点/VU', .002, .001, .02, .001, '初级生产', '土壤单元内每新增一个植被单位扣减的养分。', '养分消耗 = 实际新增 VU × 系数'),
  decayRate: coefficient('碎屑分解常数', 's⁻¹', .008, 0, .04, .001, '分解与循环', '参考温度20°C下的一阶分解常数，受温湿度修正。', '分解量 = D × (1 − exp(−k × fT × fW × Q10^((T−20)/10) × Δt))'),
  decayEfficiency: coefficient('养分回收系数', '比例', .75, 0, 1, .05, '分解与循环', '分解碎屑回收到养分指数的模型系数；不表示碳利用效率。', '养分回补 = 分解量 × 回收系数'),
  decayQ10: coefficient('分解温度敏感度 Q10', '倍/10°C', 1, 1, 3, .1, '分解与循环', '温度每上升10°C的分解倍率，仍受温度耐受与水分约束；默认1保留原模型。', '温度倍率 = Q10^((T − 20)/10)'),
  decayOptimum: coefficient('分解热适宜中心', '°C', 20, 0, 40, 1, '分解与循环', '独立于植物温度响应的分解适宜度中心；Q10乘积可能使实际峰值偏移。', '分解热适宜度 = max(0, 1 − |T − 中心| / 分解耐受宽度)'),
  decayThermalWidth: coefficient('分解温度耐受宽度', '°C', 30, 5, 60, 1, '分解与循环', '距分解适宜中心达到此值时分解归零，避免Q10无限外推。', '分解温区 = 分解热适宜中心 ± 宽度'),
  hydrationLoss: coefficient('基础失水率', '水分点/s', .175, 0, .7, .025, '摄食与生理', '体内水分指数下降速度；高温加快，休息时取0.6倍。', '失水 = 速率 × 高温修正 × 活动修正 × Δt'),
  drinkingRate: coefficient('饮水恢复率', '水分点/s', 12.5, 1, 30, .5, '摄食与生理', '在有水岸边停留时恢复体内水分。', '恢复 = 饮水率 × Δt，上限100'),
  grazingRate: coefficient('最大摄草率', 'VU/s', 3.25, .25, 8, .25, '摄食与生理', '觅食时每秒最大消耗的脚下植被量，受可用资源限制。', '摄入 = min(脚下 VU, 速率 × Δt)'),
  grazerAssimilation: coefficient('草食同化系数', 'EU/VU', .65, .1, 1, .05, '摄食与生理', '植被摄入转化为体内能量，另乘植物营养倍率；EU 为模型能量单位。', '草食收益 = 摄入 VU × 系数 × 植物营养'),
  hunterAssimilation: coefficient('捕食能量转化率', 'EU/EU', .65, .1, 1, .05, '摄食与生理', '一次捕获后从猎物剩余能量获取的比例，最低奖励8 EU、容量145 EU。', '捕食收益 = max(8, 猎物 EU × 转化率)'),
  grazerMaintenance: coefficient('兔基础维持消耗', 'EU/s', .275, .05, 1, .025, '摄食与生理', '再乘基础代谢倍率、基因、温度压力、休息和幼体修正。', '消耗 = 维持率 × 修正因子 × Δt'),
  hunterMaintenance: coefficient('狐基础维持消耗', 'EU/s', .375, .05, 1.5, .025, '摄食与生理', '捕食者的基础能量消耗；捕获并非连续摄食函数。', '消耗 = 维持率 × 修正因子 × Δt'),
  juvenileMetabolism: coefficient('幼体代谢倍率', '倍', 1.15, .5, 2, .05, '生命史与演化', '未达成熟年龄的维持代谢修正。', '幼体维持消耗 × 幼体倍率'),
  grazerMaturity: coefficient('兔成熟年龄', '模拟秒', 40, 10, 300, 5, '生命史与演化', '决定繁殖资格、幼体移动和统计分类；修改后立即重新分类。', '年龄 ≥ 成熟年龄时为成体'),
  hunterMaturity: coefficient('狐成熟年龄', '模拟秒', 65, 10, 400, 5, '生命史与演化', '成熟雄狐才可配对，成熟雌狐才可受孕。', '年龄 ≥ 成熟年龄时可参与配对'),
  grazerGestation: coefficient('兔妊娠时长', '模拟秒', 35, 5, 180, 5, '生命史与演化', '仅影响之后的新妊娠，不重写已在进行的剩余孕期。', '新受孕时剩余孕期 = 设定时长'),
  hunterGestation: coefficient('狐妊娠时长', '模拟秒', 70, 5, 240, 5, '生命史与演化', '每次成功妊娠出生一只；低能量可能中止妊娠。', '孕期每步减少 Δt'),
  grazerLifespan: coefficient('兔基准寿命', '模拟秒', 800, 100, 2400, 50, '生命史与演化', '再乘自然寿命倍率；降低上限可能使现有个体在下一步死亡。', '死亡年龄阈值 = 基准寿命 × 寿命倍率'),
  hunterLifespan: coefficient('狐基准寿命', '模拟秒', 1100, 100, 3000, 50, '生命史与演化', '确定性年龄上限，不是现实世界的期望寿命或死亡风险率。', '年龄超过阈值即死亡'),
  mateRadius: coefficient('配对距离', '格', 4, 1, 8, .5, '生命史与演化', '异性成体满足能量与冷却条件且在感知候选范围内才能配对。', '距离 < 配对距离，且候选在感知范围内'),
} as const;

export function thermalResponse(temperature: number, p: Parameters) { return Math.max(0, 1 - Math.abs(temperature - p.growthOptimum) / p.thermalWidth); }
export function growthPotential(temperature: number, moisture: number, nutrients: number, light: number, p: Parameters) {
  return p.growthRate * p.fertility * light * thermalResponse(temperature, p) * Math.min(1, moisture / p.moistureThreshold) * Math.min(1, nutrients / p.nutrientThreshold);
}
export function maturity(species: Species, p: Parameters) { return species === 'grazer' ? p.grazerMaturity : p.hunterMaturity; }
export function gestation(species: Species, p: Parameters) { return species === 'grazer' ? p.grazerGestation : p.hunterGestation; }
export function lifespan(species: Species, p: Parameters) { return (species === 'grazer' ? p.grazerLifespan : p.hunterLifespan) * p.lifespan; }
