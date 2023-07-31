/**
 * Helper classes to serialize things to JSON and back
 */
const TYPE_PROPERTY = "$type"

interface IMarshal {
  toPureJson(object: any)
  newInstance(json: any, classes?: any[]): any
  newKnownInstance(cls: any, json: any, classes?: any[]): any
}

function newInstance(className: string, classes: Record<string, any>) {
  if (className === "Object") {
    return {}
  }
  let cls = classes[className]
  if (cls === undefined) {
    throw new Error(
      `Unknown class ${className}. Pass classes to as a second argument of newInstanceInternal(). Known classes '${Object.keys(
        classes
      )}'`
    )
  }
  return new cls()
}

function classesMap(classes?: any[]) {
  if (classes === undefined) {
    return {}
  }
  let map = {}
  classes.forEach(cls => (map[cls.name] = cls))
  return map
}

function newInstanceInternal(initialInstance: any, json: any, classes: Record<string, any>) {
  if (json == null) {
    return null
  } else if (typeof json !== "object" && typeof json !== "function") {
    return json
  } else if (typeof json == "object") {
    if (Array.isArray(json)) {
      return (json as any[]).map(element => newInstanceInternal(null, element, classes))
    } else {
      let instance
      if (json[TYPE_PROPERTY] !== undefined) {
        instance = newInstance(json[TYPE_PROPERTY], classes)
      } else {
        instance = initialInstance ? initialInstance : new Object()
      }
      for (let key in json) {
        if (json.hasOwnProperty(key) && key != TYPE_PROPERTY) {
          instance[key] = newInstanceInternal(null, json[key], classes)
        }
      }
      return instance
    }
  } else {
    throw new Error(`Unsupported object type ${typeof json}`)
  }
}

const Marshal: IMarshal = {
  newKnownInstance(cls: any, json: any, classes?: any[]): any {
    if (!cls) {
      throw new Error(`Class should be defined, not ${cls}`)
    }
    let allClasses = classes ? [...classes, cls] : [cls]
    return newInstanceInternal(new cls(), json, classesMap(allClasses))
  },

  newInstance: (json: any, classes?: any[]) => {
    return newInstanceInternal(null, json, classesMap(classes))
  },

  toPureJson: (object: any) => {
    if (object == null) {
      return null
    } else if (typeof object !== "object" && typeof object !== "function") {
      return object
    } else if (typeof object == "object") {
      if (Array.isArray(object)) {
        return (object as any[]).map(element => Marshal.toPureJson(element))
      } else {
        let result = {}
        if (object.constructor.name !== "Object") {
          result[TYPE_PROPERTY] = object.constructor.name
        }
        for (let key in object) {
          let val = object[key]
          if (typeof val !== "function") {
            result[key] = Marshal.toPureJson(val)
          }
        }
        return result
      }
    } else {
      throw new Error(`Unsupported object type ${typeof object}`)
    }
  },
}

export default Marshal
