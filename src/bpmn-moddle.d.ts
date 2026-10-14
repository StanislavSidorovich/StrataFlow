// bpmn-moddle 10 ships element types under 'bpmn-moddle/types' but none for its entry point.
declare module 'bpmn-moddle' {
  export class BpmnModdle {
    constructor(packages?: object, options?: object)
    fromXML(xml: string, typeName?: string): Promise<{ rootElement: unknown; warnings: { message: string }[] }>
    toXML(element: unknown, options?: { format?: boolean }): Promise<{ xml: string }>
    create(type: string, attrs?: object): any
  }
}
