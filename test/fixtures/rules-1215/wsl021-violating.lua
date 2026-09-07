-- SetCooldown and Clear on cooldown frames Blizzard protects.
local cd = _G["ActionButton1Cooldown"]
cd:SetCooldown(GetTime(), 10)
ActionButton2Cooldown:Clear()
_G["MultiBarBottomLeftButton3Cooldown"]:SetCooldownDuration(5)

local name = "PetActionButton" .. 4 .. "Cooldown"
local pet = _G[name]
pet:SetCooldownFromExpirationTime(GetTime() + 5, 5)

ActionButton5.cooldown:SetCooldownUNIX(0, 0)
_G["ActionButton6"].chargeCooldown:SetCooldownFromDurationObject(nil)

local explicit = CreateFrame("Cooldown", nil, UIParent, "SecureFrameTemplate")
explicit:Clear()
