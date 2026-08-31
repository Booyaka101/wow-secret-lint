-- WSL013 negative: permitted uses of the newly secret identity APIs.
local localizedClass, classFile = UnitClass("target")
local stash = classFile                           -- storing is allowed
print(string.format("class: %s", localizedClass)) -- sanctioned render path
local label = "class " .. classFile               -- concat of a string secret
if localizedClass then                            -- boolean test on a cstring return
	print("known")
end
if not issecretvalue(classFile) then
	if classFile == "MAGE" then                   -- guarded, taint cleared
		print("sheep it")
	end
end
if UnitIsCharmed("player") then                   -- player/pet/vehicle tokens are documented non-secret
	print("charmed")
end
if UnitIsPossessed("vehicle") then
	print("possessed")
end
local _, myClass = UnitClass("player")            -- a unit is never secret to itself
if myClass == "MAGE" then
	print("me")
end
