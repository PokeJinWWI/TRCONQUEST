// Tuning for the Situations panel (scene/situations.ts): the lines past which a
// condition is worth flagging. These are display thresholds only; they change
// no game rule.

// A ship is "damaged" past this share of its hull/armour lost (shipRepair.damageFraction).
export const SITUATION_DAMAGE_MIN = 0.05
// An army is "under strength" below this share of its full strength.
export const SITUATION_ARMY_STRENGTH_MIN = 0.7
// A strategic resource is "running out" when its monthly change empties it within this many months.
export const SITUATION_RUNOUT_MONTHS = 6
// A deposit is "nearly dry" at or below this many units left.
export const SITUATION_DEPOSIT_LOW = 5
// A world has "low standard of living" when this share of its people (or more) is below SITUATION_LOW_SOL.
export const SITUATION_LOW_SOL = 0.3
export const SITUATION_LOW_SOL_SHARE = 0.2
// A world has "unemployment" when its employment rate is below this.
export const SITUATION_EMPLOYMENT_MIN = 0.85
// Influence counts as "at cap" (income being wasted) at this share of the cap.
export const SITUATION_INFLUENCE_CAP_SHARE = 0.98
// Encroachments and incidents against the player stay listed for this long.
export const SITUATION_RECENT_DAYS = 180
// A Starbase "finishing soon" is listed (info) within this many days of being ready.
export const SITUATION_STARBASE_SOON_DAYS = 30
// A good is "expensive" at or above this multiple of its normal price (the world's calibrated starting price,
// else the good's base price), "cheap" at or below the low one. Only goods the world actually trades count.
export const SITUATION_PRICE_HIGH = 1.6
export const SITUATION_PRICE_LOW = 0.6
// Annual inflation (or deflation, negative) past which it is flagged.
export const SITUATION_INFLATION_HIGH = 0.08
export const SITUATION_DEFLATION = -0.02
// A good is "piling up" when made at this multiple (or more) of what is used, eaten and sold, and its stock grows.
export const SITUATION_SURPLUS_RATIO = 2.5
