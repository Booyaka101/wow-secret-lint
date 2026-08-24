-- hooksecurefunc callbacks: the callback body is analysed like any other function.
local function OnHealthUpdate(self, unit)
	local hp = UnitHealth(unit)
	self.text:SetText(hp * 100)      -- WSL001 inside the callback
end

hooksecurefunc("UnitFrameHealthBar_Update", OnHealthUpdate)

hooksecurefunc(CompactUnitFrame, "UpdateHealthColor", function(frame)
	local hp = UnitHealth(frame.unit)
	if hp < 0.35 then                -- WSL002 inside an anonymous callback
		frame.healthBar:SetStatusBarColor(1, 0, 0)
	end
end)
