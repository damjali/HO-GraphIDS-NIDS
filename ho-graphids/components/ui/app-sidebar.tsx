"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Cpu, FlaskConical, Home, Network, UploadCloud } from "lucide-react"

import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar"

const navItems = [
    { title: "Dashboard", url: "/", icon: Home },
    { title: "Data Upload", url: "/upload", icon: UploadCloud },
    { title: "Network Explorer", url: "/explorer", icon: Network },
    { title: "Train", url: "/training", icon: Cpu },
    { title: "Test", url: "/testing", icon: FlaskConical },
]

export function AppSidebar() {
    const pathname = usePathname()

    return (
        <Sidebar>
            <SidebarHeader className="p-4 border-b">
                <h2 className="text-lg font-bold">HO-GraphIDS</h2>
            </SidebarHeader>
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>Application</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {navItems.map((item) => {
                                const isActive = pathname === item.url

                                return (
                                    <SidebarMenuItem key={item.title}>
                                        <SidebarMenuButton
                                            render={<Link href={item.url} />}
                                            isActive={isActive}
                                        >
                                            <item.icon />
                                            <span>{item.title}</span>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                )
                            })}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
        </Sidebar>
    )
}