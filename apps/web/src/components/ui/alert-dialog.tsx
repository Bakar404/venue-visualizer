"use client"

import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"

import { dialogPopupClass } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogClose({ ...props }: AlertDialogPrimitive.Close.Props) {
  return <AlertDialogPrimitive.Close data-slot="alert-dialog-close" {...props} />
}

function AlertDialogContent({ className, children, ...props }: AlertDialogPrimitive.Popup.Props) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Backdrop className="fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
      <AlertDialogPrimitive.Popup data-slot="alert-dialog-content" className={cn(dialogPopupClass, className)} {...props}>
        {children}
      </AlertDialogPrimitive.Popup>
    </AlertDialogPrimitive.Portal>
  )
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return <AlertDialogPrimitive.Title className={cn("font-heading text-base leading-snug font-medium", className)} {...props} />
}

function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props) {
  return <AlertDialogPrimitive.Description className={cn("text-sm text-pretty text-muted-foreground", className)} {...props} />
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end", className)} {...props} />
}

export { AlertDialog, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle }
