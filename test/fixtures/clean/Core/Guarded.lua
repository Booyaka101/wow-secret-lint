-- Every secret value here is read behind a documented guard, so nothing is reported.
local UnitFrame = {}

function UnitFrame:UpdateHealth(unit)
	local hp = UnitHealth(unit)
	local max = UnitHealthMax(unit)

	if not issecretvalue(hp) and not issecretvalue(max) then
		local pct = hp / max * 100
		if hp < max then
			self.bar:SetValue(pct)
		end
	end

	local absorb = UnitGetTotalAbsorbs(unit)
	if canaccessvalue(absorb) then
		self.absorbBar:SetValue(absorb + 0)
	end

	local cooldown = C_Spell.GetSpellCooldown(self.spellID)
	if canaccessvalue(cooldown.startTime) and cooldown.startTime ~= 0 then
		self.cd:SetCooldown(cooldown.startTime, cooldown.duration)
	end
end

function UnitFrame:UpdateAuraTable(unit)
	local results = C_LFGList.GetSearchResultInfo(self.resultID)
	if canaccesstable(results) then
		self.activity = results.activityIDs[1]
	end
end

function UnitFrame:EarlyReturn(unit)
	local incoming = UnitGetIncomingHeals(unit)
	if issecretvalue(incoming) then
		return
	end
	self.heals:SetValue(incoming * 2)
end

function UnitFrame:FrameGate()
	if not self.statusText:HasSecretValues() then
		self.width = self.statusText.value + 4
	end
end

return UnitFrame
