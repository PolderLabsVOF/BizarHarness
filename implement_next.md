fully integrate bizar with opencode using the sdk and make sure chat sessions and streaminf and everything works in bizar dash. make sure tasks and bacxkground agents are properly implemented. we need to make the system service work properly now. when configured the service should always run in the back nd run the dashboard so its always accessible. so when the user wants to create a task they open the dash, create a task and the agnents start working. the service should periodically check the tasks to see if there are new items. add a backlog section where users can put ideas that are not to be implemented yet. only items in to do should be done by agents. odin should decide what tasks and in what order to do them. use the bizar dev repo and folder to fully test everything in the dev container set up in that. 

https://opencode.ai/docs/sdk/
https://opencode.ai/docs/server/
https://opencode.ai/docs/plugins/
https://opencode.ai/docs/custom-tools/


update the dashboard chat tab with /home/drb0rk/Projects/open-design/.od/projects/ea47b7b3-9f17-41f4-871e-0c5b4c7114df/index.html, i created an updated design here, implement it into the dahsboard chat tab and apply these fixes to it:
- when a session is clicked it should open collapsed by default
- the three dot menu and the collapse arrow overlap. and the notification number indicator has weird positioning
- do general small cleanup

make sure the tmux background agents work well and are correctly implemented.

make sure all agents know what bizar tools are available and what tools to use when and how to use them. take inspiration from https://github.com/affaan-m/ECC/tree/main/.opencode and https://github.com/affaan-m/ECC/tree/main for the structure and functions. DO NOT IMPLEMENT ANY ECC FEATURES ONLY USE THIS FOR INSPIRATION TO SEE HOW ITS DONE. 

most important tools:
- headroom
- semble
- bizar memory (obsidian + lightrag with git)
- bizar commands and background agents
- skill finder

make sure the installer and updater work perfectly and check for all dependencies nd installs everything thats missing. it should fully configure and setup everything. make sure it works on multiple distros and on windows. 


fully research and implement everything, cointinue untill done. dont be afraid to make big changes, but always do research and web searches. 

when done commit push and full publish new version. 