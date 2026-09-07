-- A cooldown the addon created itself is not protected, and reading a protected one is not
-- a protected function.
local mine = CreateFrame("Cooldown", nil, UIParent, "CooldownFrameTemplate")
mine:SetCooldown(GetTime(), 10)
mine:Clear()

-- Parenting runs the other way: a protected child implicitly protects its parent, so a
-- cooldown built under a secure button is not itself protected.
local secure = CreateFrame("CheckButton", "MyBarButton1", UIParent, "SecureActionButtonTemplate")
local ownCooldown = CreateFrame("Cooldown", "MyBarButton1Cooldown", secure, "CooldownFrameTemplate")
secure.cooldown = ownCooldown
secure.cooldown:SetCooldownDuration(3)
MyBarButton1Cooldown:SetCooldown(GetTime(), 5)

local blizzard = _G["ActionButton1Cooldown"]
blizzard:Pause()
blizzard:Resume()
if blizzard:IsPaused() then return end
